import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { getSocialConnection } from '@omniply/shared'
import { decrypt } from '@omniply/shared'

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2'
const FACEBOOK_API_BASE = 'https://graph.facebook.com/v24.0'

type RouteContext = {
  params: Promise<{
    platform: string
  }>
}

// GET /api/social/[platform]/pages - Fetch available pages for LinkedIn or Facebook
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  let platform: string | undefined
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    platform = params.platform

    if (platform !== 'linkedin' && platform !== 'facebook') {
      return NextResponse.json(
        { error: 'Platform must be linkedin or facebook' },
        { status: 400 }
      )
    }

    // Get user from Clerk ID
    const { prisma } = await import('@omniply/shared')
    const user = await prisma.user.findUnique({
      where: { clerkId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // For LinkedIn, try to get company connection first (for fetching pages)
    // If not found, fall back to personal connection
    let connection = null
    try {
      if (platform === 'linkedin') {
        // Try company connection first (for Company Pages)
        connection = await getSocialConnection(user.id, platform, 'company')
        // If no company connection, try personal (but it won't have access to Company Pages)
        if (!connection) {
          console.warn('[LinkedIn Pages API] No company connection found, trying personal connection (this will not work for Company Pages)')
          connection = await getSocialConnection(user.id, platform, 'personal')
          if (connection) {
            console.warn('[LinkedIn Pages API] Using personal connection - Company Pages will not be available. Please connect using the "Company Page" button (not "Personal Profile" or "Business Page").')
          }
        }
      } else {
        connection = await getSocialConnection(user.id, platform)
      }
    } catch (error: unknown) {
      interface PrismaError extends Error {
        code?: string
        message: string
      }

      interface SocialConnectionWithAppType {
        appType: string | null
        accessToken: string
        refreshToken: string | null
        [key: string]: unknown
      }

      const prismaError = error as PrismaError
      console.error(`[Pages API] Error fetching ${platform} connection:`, prismaError)
      // If it's a constraint error, try without appType filtering
      if (prismaError.message?.includes('userId_platform_appType') || 
          prismaError.message?.includes('Unknown argument')) {
        // Fallback: try to get any connection for this platform
        const connections = await prisma.socialConnection.findMany({
          where: {
            userId: user.id,
            platform,
            isActive: true,
          },
          take: 1,
        })
        if (connections.length > 0) {
          const conn = connections[0]
          connection = {
            ...conn,
            appType: platform === 'linkedin' ? ((conn as SocialConnectionWithAppType).appType || 'personal') : null,
            accessToken: decrypt(conn.accessToken),
            refreshToken: conn.refreshToken ? decrypt(conn.refreshToken) : null,
          } as SocialConnectionWithAppType & { accessToken: string; refreshToken: string | null }
        }
      } else {
        throw error
      }
    }
    
    if (!connection) {
      return NextResponse.json(
        { error: `${platform} account not connected` },
        { status: 404 }
      )
    }
    
    // Log which connection type is being used
    if (platform === 'linkedin') {
      console.log('[LinkedIn Pages API] Using connection', {
        appType: connection.appType,
        platformUsername: connection.platformUsername,
        connectionId: connection.id,
        note: connection.appType === 'personal' ? 'WARNING: Using personal connection - Company Pages require appType=company. Make sure you connected using the "Company Page" button, not "Personal Profile".' : 'Using company connection - this should work for Company Pages.',
      })
    }

    // Check if token needs refresh
    if (connection.tokenExpiry && new Date(connection.tokenExpiry as Date) <= new Date()) {
      return NextResponse.json(
        { error: 'Access token expired. Please reconnect your account.' },
        { status: 401 }
      )
    }

    // Note: getSocialConnection already decrypts the token, so we use it directly
    const accessToken = connection.accessToken

    // Debug: Check token permissions for Facebook
    if (platform === 'facebook') {
      try {
        const debugResponse = await fetch(
          `${FACEBOOK_API_BASE}/me/permissions?access_token=${accessToken}`
        )
        if (debugResponse.ok) {
          const debugData = await debugResponse.json()
          console.log('[Facebook Pages API] Token permissions:', debugData)
        }
      } catch (e) {
        console.warn('[Facebook Pages API] Could not check permissions:', e)
      }
    }

    if (platform === 'linkedin') {
      // First, check if the token has the required scopes for Company Pages
      // We can't directly check scopes from the token, but we can try the API call
      // and check the error response
      
      // Fetch LinkedIn Company Pages
      // LinkedIn requires w_organization_social + rw_organization_admin (or r_organization_admin) scopes to access company pages
      // Using organizationalEntityAcls endpoint (correct endpoint name per LinkedIn API docs)
      // Note: Query tunneling may be required for long URLs (see LinkedIn API docs)
      console.log('[LinkedIn Pages API] Attempting to fetch organizations with access token')
      // Fetch LinkedIn Company Pages - try with basic fields first
      const orgsResponse = await fetch(
        `${LINKEDIN_API_BASE}/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organizationalTarget~(id,name,vanityName)))`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      )

      interface LinkedInError {
        code?: string
        message?: string
        [key: string]: unknown
      }

      if (!orgsResponse.ok) {
        const errorText = await orgsResponse.text()
        let errorData: LinkedInError = {}
        try {
          errorData = JSON.parse(errorText) as LinkedInError
        } catch {
          errorData = { message: errorText }
        }
        
        console.error('[LinkedIn Pages API] Failed to fetch organizations:', {
          status: orgsResponse.status,
          error: errorData,
        })
        
        // If we don't have permission or token invalid, return empty array
        if (orgsResponse.status === 403 || orgsResponse.status === 401 || orgsResponse.status === 400) {
          const errorCode = errorData.code || ''
          const errorMessage = errorData.message || ''
          
          // Check if this is a scope/permission issue
          const isScopeIssue = errorCode === 'ACCESS_DENIED' || 
                              errorMessage.includes('permissions') ||
                              errorMessage.includes('w_organization_social') ||
                              errorMessage.includes('r_organization_admin') ||
                              errorMessage.includes('rw_organization_admin') ||
                              errorMessage.includes('organizationalEntityAcls')
          
          console.warn('[LinkedIn Pages API] Company Pages not available:', {
            reason: isScopeIssue 
              ? 'LinkedIn Company Pages require w_organization_social and rw_organization_admin (or r_organization_admin) scopes (Community Management API product)'
              : 'LinkedIn Company Pages require the "Community Management API" product (MDP was deprecated April 2024)',
            errorCode: errorCode,
            errorMessage: errorMessage,
            note: 'Make sure you connected using the "Company Page" button, not "Personal Profile". Company Pages require a separate LinkedIn app with Community Management API approval and both w_organization_social and rw_organization_admin (or r_organization_admin) scopes.',
            endpoint: 'organizationalEntityAcls (correct endpoint per LinkedIn API docs)',
            moreInfo: 'See: https://www.linkedin.com/help/linkedin/answer/a527267/ for Community Management API access',
          })
          return NextResponse.json({ pages: [] })
        }
        
        return NextResponse.json(
          { error: `Failed to fetch LinkedIn pages: ${errorData.message || orgsResponse.status}` },
          { status: orgsResponse.status }
        )
      }

      interface LinkedInOrgElement {
        organizationalTarget: {
          id: string
          name?: string
          vanityName?: string
          localizedName?: {
            [locale: string]: string // e.g., { "en_US": "Company Name" }
          }
        } | string // Can be a string URN when rate-limited (e.g., "urn:li:organization:123456789")
        'organizationalTarget!'?: {
          message?: string
          status?: number
        }
      }

      interface LinkedInOrgsResponse {
        elements?: LinkedInOrgElement[]
      }

      const orgsData = await orgsResponse.json() as LinkedInOrgsResponse
      console.log('[LinkedIn Pages API] Raw API response:', JSON.stringify(orgsData, null, 2))
      
      // First pass: Extract organization IDs and check which ones need name fetching
      const orgsToFetch: Array<{ id: string; urn: string }> = []
      const pagesWithNames: Array<{ id: string; name: string; vanityName?: string }> = []
      
      for (const element of orgsData.elements || []) {
        const org = element.organizationalTarget
        const error = element['organizationalTarget!']
        
        // Check if this is a rate limit error
        if (error && error.status === 429) {
          console.warn('[LinkedIn Pages API] Rate limit hit for organization details:', error.message)
        }
        
        // Handle case where organizationalTarget is a string URN (rate-limited response)
        let orgId: string
        let orgName: string | undefined
        let orgVanityName: string | undefined
        
        if (typeof org === 'string') {
          // Extract organization ID from URN format: "urn:li:organization:123456789"
          const urnMatch = org.match(/urn:li:organization:(\d+)/)
          orgId = urnMatch ? urnMatch[1] : org
          orgName = undefined
          orgVanityName = undefined
          console.log('[LinkedIn Pages API] Processing organization (rate-limited, URN only):', {
            urn: org,
            extractedId: orgId,
          })
          // Store for later fetching
          orgsToFetch.push({ id: orgId, urn: org })
        } else {
          // Normal case: organizationalTarget is an object
          orgId = org.id
          orgName = org.name
          orgVanityName = org.vanityName
          console.log('[LinkedIn Pages API] Processing organization:', {
            id: org.id,
            name: org.name,
            vanityName: org.vanityName,
            localizedName: org.localizedName,
          })
          
          // Try to get name from localizedName if available
          if (!orgName && org.localizedName) {
            orgName = org.localizedName.en_US || 
                     org.localizedName.en || 
                     Object.values(org.localizedName)[0] || 
                     undefined
          }
          
          // If we have a name, add to pagesWithNames immediately
          if (orgName || orgVanityName) {
            pagesWithNames.push({
              id: orgId,
              name: orgName || orgVanityName || 'Unnamed Page',
              vanityName: orgVanityName,
            })
          } else {
            // No name available, need to fetch
            orgsToFetch.push({ id: orgId, urn: `urn:li:organization:${orgId}` })
          }
        }
      }
      
      // Second pass: Fetch organization names for URNs (rate-limited cases)
      if (orgsToFetch.length > 0) {
        console.log(`[LinkedIn Pages API] Fetching organization names for ${orgsToFetch.length} organizations...`)
        
        for (const orgInfo of orgsToFetch) {
          try {
            // Fetch organization details using /v2/organizations/{orgId} endpoint
            // Add delay between requests to avoid rate limits
            if (orgsToFetch.indexOf(orgInfo) > 0) {
              await new Promise(resolve => setTimeout(resolve, 500)) // 500ms delay between requests
            }
            
            const orgDetailsResponse = await fetch(
              `${LINKEDIN_API_BASE}/organizations/${orgInfo.id}?projection=(id,name,vanityName,localizedName)`,
              {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                },
              }
            )
            
            if (orgDetailsResponse.ok) {
              const orgDetails = await orgDetailsResponse.json() as {
                id: string
                name?: string | { localized?: { [locale: string]: string }; preferredLocale?: { country: string; language: string } }
                vanityName?: string
                localizedName?: { [locale: string]: string }
              }
              
              // Extract name - can be a string or an object with localized/preferredLocale
              let orgName: string | undefined
              
              if (typeof orgDetails.name === 'string') {
                orgName = orgDetails.name
              } else if (orgDetails.name && typeof orgDetails.name === 'object') {
                // Handle object format: { localized: { en_US: '...' }, preferredLocale: {...} }
                const nameObj = orgDetails.name as { localized?: { [locale: string]: string }; preferredLocale?: { country: string; language: string } }
                if (nameObj.localized) {
                  orgName = nameObj.localized.en_US || 
                           nameObj.localized.en || 
                           Object.values(nameObj.localized)[0] || 
                           undefined
                }
              }
              
              // Fallback to vanityName or localizedName
              if (!orgName) {
                orgName = orgDetails.vanityName
              }
              
              if (!orgName && orgDetails.localizedName) {
                orgName = orgDetails.localizedName.en_US || 
                         orgDetails.localizedName.en || 
                         Object.values(orgDetails.localizedName)[0] || 
                         undefined
              }
              
              pagesWithNames.push({
                id: orgInfo.id,
                name: orgName || `Company Page (${orgInfo.id.substring(orgInfo.id.length - 8)})`,
                vanityName: orgDetails.vanityName,
              })
              
              console.log(`[LinkedIn Pages API] Fetched organization name for ${orgInfo.id}:`, orgName)
            } else {
              // If fetching fails, use fallback name
              const errorText = await orgDetailsResponse.text()
              console.warn(`[LinkedIn Pages API] Failed to fetch organization ${orgInfo.id}:`, {
                status: orgDetailsResponse.status,
                error: errorText,
              })
              
              pagesWithNames.push({
                id: orgInfo.id,
                name: `Company Page (${orgInfo.id.substring(orgInfo.id.length - 8)})`,
                vanityName: undefined,
              })
            }
          } catch (fetchError) {
            console.error(`[LinkedIn Pages API] Error fetching organization ${orgInfo.id}:`, fetchError)
            // Use fallback name on error
            pagesWithNames.push({
              id: orgInfo.id,
              name: `Company Page (${orgInfo.id.substring(orgInfo.id.length - 8)})`,
              vanityName: undefined,
            })
          }
        }
      }

      console.log('[LinkedIn Pages API] Processed pages:', pagesWithNames)
      return NextResponse.json({ pages: pagesWithNames })
    } else if (platform === 'facebook') {
      // Fetch Facebook Pages
      // Note: Requires pages_show_list permission on the user access token
      console.log('[Facebook Pages API] Fetching pages with access token (first 10 chars):', accessToken.substring(0, 10) + '...')
      
      const pagesResponse = await fetch(
        `${FACEBOOK_API_BASE}/me/accounts?access_token=${accessToken}&fields=id,name,access_token`
      )

      interface FacebookError {
        error?: {
          message?: string
          code?: number
        }
        message?: string
        [key: string]: unknown
      }

      if (!pagesResponse.ok) {
        const errorText = await pagesResponse.text()
        let errorData: FacebookError = {}
        try {
          errorData = JSON.parse(errorText) as FacebookError
        } catch {
          errorData = { message: errorText }
        }
        
        console.error('[Facebook Pages API] Failed to fetch pages:', {
          status: pagesResponse.status,
          statusText: pagesResponse.statusText,
          error: errorData,
          url: `${FACEBOOK_API_BASE}/me/accounts?access_token=${accessToken.substring(0, 10)}...`,
        })
        
        // Log the full error for debugging
        console.error('[Facebook Pages API] Full error response:', errorText)
        
        // Check if this is a rate limit error (code 4, is_transient: true)
        const isRateLimit = errorData.error?.code === 4 && 
                           (errorData.error as { is_transient?: boolean }).is_transient === true
        
        // If permission denied, token invalid, or rate limited, bubble the error up to the client
        if (pagesResponse.status === 400 || pagesResponse.status === 401 || pagesResponse.status === 403) {
          const errorMessage = errorData.error?.message || errorData.message || pagesResponse.statusText
          
          if (isRateLimit) {
            console.warn('[Facebook Pages API] Rate limit reached, returning error to client')
            return NextResponse.json(
              {
                error: 'Facebook API rate limit reached. Please wait a few minutes and try again.',
                rateLimit: true,
                retryAfterMs: 5 * 60 * 1000,
                details: errorMessage,
              },
              { status: 429 }
            )
          }

          console.warn('[Facebook Pages API] Permission issue or no pages available:', errorMessage)
          return NextResponse.json(
            {
              error: errorMessage || 'Facebook API permissions issue. Please reconnect your Facebook account.',
              code: errorData.error?.code,
            },
            { status: pagesResponse.status }
          )
        }
        
        return NextResponse.json(
          { error: `Failed to fetch Facebook pages: ${errorData.error?.message || errorData.message || pagesResponse.status}` },
          { status: pagesResponse.status }
        )
      }

      const pagesData = await pagesResponse.json()
      console.log('[Facebook Pages API] Raw response:', JSON.stringify(pagesData, null, 2))
      
      // Handle case where API returns an error object instead of data array
      if (pagesData.error) {
        console.error('[Facebook Pages API] API returned error:', pagesData.error)
        const isRateLimit = pagesData.error.code === 4 && pagesData.error.is_transient === true
        if (isRateLimit) {
          return NextResponse.json(
            {
              error: 'Facebook API rate limit reached. Please wait a few minutes and try again.',
              rateLimit: true,
              retryAfterMs: 5 * 60 * 1000,
              details: pagesData.error.message,
            },
            { status: 429 }
          )
        }
        return NextResponse.json(
          {
            error: pagesData.error.message || 'Failed to fetch Facebook pages.',
            code: pagesData.error.code,
          },
          { status: 400 }
        )
      }
      
      interface FacebookPage {
        id: string
        name: string
        access_token?: string
      }

      const pages = (pagesData.data || []).map((page: FacebookPage) => ({
        id: page.id,
        name: page.name,
        access_token: page.access_token, // Page access token needed for posting
      }))

      console.log('[Facebook Pages API] Found pages:', pages.length, pages.map((p: { id: string; name: string; access_token: string }) => p.name))
      return NextResponse.json({ pages })
    }

    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
  } catch (error) {
    console.error(`Error fetching ${platform || 'unknown'} pages:`, error)
    // Return empty array instead of error to prevent UI issues
    // The user can still use the app even if pages can't be fetched
    return NextResponse.json({ pages: [] })
  }
}

