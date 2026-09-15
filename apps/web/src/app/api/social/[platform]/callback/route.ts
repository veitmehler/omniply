import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { prisma } from '@omniply/shared'
import { encrypt, decrypt } from '@omniply/shared'
import { verifyOAuthState } from '@/lib/oauth'
import { fetchInstagramUsername as fetchInstagramUsernameUtil } from '@omniply/shared'
import { VALID_PLATFORMS } from '@/features/social-callbacks/config'
import { getOrCreateUser } from '@/features/social-callbacks/getOrCreateUser'
import { handleLinkedinCallback } from '@/features/social-callbacks/linkedin'
import { handleTwitterCallback } from '@/features/social-callbacks/twitter'
import { handleFacebookCallback } from '@/features/social-callbacks/facebook'
import { handleInstagramCallback } from '@/features/social-callbacks/instagram'
import { handleThreadsCallback } from '@/features/social-callbacks/threads'
import type { CallbackOutcome, PrismaError, RequestWithInstagramParams } from '@/features/social-callbacks/types'

function isAppTypeColumnError(error: unknown): boolean {
  const prismaError = error as PrismaError
  const message = prismaError?.message || ''
  return (
    message.includes('Unknown argument `appType`') ||
    message.includes('no such column: appType') ||
    message.includes('column "appType" of relation "social_connections" does not exist') ||
    prismaError?.code === 'P2001'
  )
}

type RouteContext = {
  params: Promise<{
    platform: string
  }>
}

// GET /api/social/[platform]/callback - Handle OAuth callback
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { platform } = await context.params

    if (!VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { error: `Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}` },
        { status: 400 }
      )
    }

    const stateCookieName = `oauth_state_${platform}`
    let stateCookieData: { state: string; codeVerifier?: string; target?: 'personal' | 'company' } | null = null
    const stateCookieValue = request.cookies.get(stateCookieName)?.value
    if (stateCookieValue) {
      try {
        stateCookieData = JSON.parse(stateCookieValue)
      } catch (cookieError) {
        console.warn('Failed to parse OAuth state cookie:', cookieError)
      }
    }

    const redirectWithCleanup = (relativePath: string) => {
      const response = NextResponse.redirect(new URL(relativePath, request.url))
      response.cookies.delete(stateCookieName)
      return response
    }

    // Get OAuth parameters from query string
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      // Handle specific LinkedIn scope errors gracefully
      const errorDescription = searchParams.get('error_description') || ''

      // Handle w_organization_social scope error - this is optional for Company Pages
      // Users can still connect and post to personal profiles without it
      if (error === 'unauthorized_scope_error' && errorDescription.includes('w_organization_social')) {
        console.warn('[LinkedIn OAuth] w_organization_social scope not approved - connecting without Company Pages support')
        // Remove w_organization_social from scope and retry
        // We'll handle this by allowing connection without Company Pages
        return redirectWithCleanup(`/settings?error=w_organization_social_not_approved&message=${encodeURIComponent('LinkedIn Company Pages are not available. You can still connect and post to your personal profile. To enable Company Pages, request w_organization_social permission in your LinkedIn Developer Portal.')}`)
      }

      if (error === 'unauthorized_scope_error' && errorDescription.includes('r_member_social')) {
        // r_member_social is not approved yet - redirect with a helpful message
        return redirectWithCleanup(`/settings?error=scope_not_approved&scope=r_member_social&message=${encodeURIComponent('The r_member_social permission is required for analytics but is not yet approved for your LinkedIn app. Please request this permission in your LinkedIn Developer Portal.')}`)
      }

      return redirectWithCleanup(`/settings?error=${encodeURIComponent(error)}${errorDescription ? '&error_description=' + encodeURIComponent(errorDescription) : ''}`)
    }

    if (!code || !state) {
      return NextResponse.json(
        { error: 'Missing OAuth parameters' },
        { status: 400 }
      )
    }

    // Verify state token (DB-backed, async; cookies remain as fallback below)
    let stateVerification = await verifyOAuthState(state, clerkId, platform)

    if (!stateVerification.valid && stateCookieData?.state === state) {
      // Fallback to cookie data if state token not found (for Twitter PKCE)
      // Note: For LinkedIn, we should always have the state in the store, not cookies
      console.warn(`[OAuth Callback] State not found in store, using cookie fallback for ${platform}`)
      stateVerification = {
        valid: true,
        codeVerifier: stateCookieData.codeVerifier,
        target: stateCookieData.target as 'personal' | 'company' | undefined,
      }
    }

    if (!stateVerification.valid) {
      console.error(`[OAuth Callback] Invalid state token for ${platform}`, {
        state,
        clerkId,
        platform,
        cookieState: stateCookieData?.state,
      })
      return redirectWithCleanup('/settings?error=invalid_state')
    }

    // Get target type from state verification (for LinkedIn)
    const targetType = stateVerification.target
    console.log(`[OAuth Callback] State verified for ${platform}`, {
      targetType,
      hasTarget: targetType !== undefined,
      platform,
    })

    const user = await getOrCreateUser(clerkId)

    // Exchange authorization code for access token (per-platform handlers)
    let outcome: CallbackOutcome
    if (platform === 'linkedin') {
      outcome = await handleLinkedinCallback({ code, targetType, redirectWithCleanup })
    } else if (platform === 'twitter') {
      outcome = await handleTwitterCallback({ code, codeVerifier: stateVerification.codeVerifier, redirectWithCleanup })
    } else if (platform === 'facebook') {
      outcome = await handleFacebookCallback({ code, redirectWithCleanup })
    } else if (platform === 'instagram') {
      outcome = await handleInstagramCallback({ code, request, userId: user.id, redirectWithCleanup })
    } else if (platform === 'threads') {
      outcome = await handleThreadsCallback({ code, redirectWithCleanup })
    } else {
      return NextResponse.json(
        { error: `Unsupported platform: ${platform}` },
        { status: 400 }
      )
    }

    if (outcome.kind === 'redirect') {
      return outcome.response
    }

    const { accessToken, refreshToken, tokenExpiry, platformUserId, platformUsername } = outcome
    const tokenData = outcome.tokenData ?? null
    const isCompanyCallback = outcome.isCompanyCallback ?? false
    let appTypeColumnAvailable: boolean | null = null // Track if social_connections.appType column exists (null = unknown)

    // For LinkedIn, determine app type from scopes or targetType
    // For other platforms, appType is null
    let connectionAppType: 'personal' | 'company' | null = null
    if (platform === 'linkedin') {
      const scopes = (tokenData?.scope as string)?.split(' ') || []
      const hasOrganizationScope = scopes.includes('w_organization_social') || scopes.includes('r_organization_admin') || scopes.includes('rw_organization_admin')
      // Use targetType from state, or determine from scopes
      connectionAppType = targetType === 'company' || hasOrganizationScope ? 'company' : 'personal'

      console.log('[LinkedIn OAuth] Determining app type', {
        targetType,
        isCompanyCallback,
        scopes: scopes,
        hasOrganizationScope,
        connectionAppType,
      })
    }

    // Check if connection already exists (for LinkedIn, check by appType)
    // Handle case where unique constraint doesn't exist yet (before migration)
    let existingConnection = null
    try {
      existingConnection = await prisma.socialConnection.findUnique({
        where: {
          userId_platform_appType: {
            userId: user.id,
            platform,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            appType: connectionAppType as any,
          },
        },
      })
      appTypeColumnAvailable = true
    } catch (error: unknown) {
      const prismaError = error as PrismaError
      // If unique constraint doesn't exist yet, use findFirst
      if (prismaError.message?.includes('userId_platform_appType') ||
          prismaError.message?.includes('Unknown argument') ||
          prismaError.code === 'P2009') {
        // Don't include appType in where clause - column doesn't exist yet
        // After migration, appType will be handled by the unique constraint above
        appTypeColumnAvailable = false
        const whereClause: { userId: string; platform: string; appType?: string | null } = {
          userId: user.id,
          platform,
        }
        // Note: Before migration, this will return the first connection for this platform
        // After migration, the unique constraint will handle appType filtering
        existingConnection = await prisma.socialConnection.findFirst({
          where: whereClause,
        })
      } else {
        throw error
      }
    }

    let savedConnectionId: string | null = null

    if (existingConnection) {
      // Update existing connection
      await prisma.socialConnection.update({
        where: { id: existingConnection.id },
        data: {
          accessToken: encrypt(accessToken),
          refreshToken: refreshToken ? encrypt(refreshToken) : null,
          tokenExpiry: tokenExpiry,
          platformUserId,
          platformUsername,
          isActive: true,
          lastUsed: new Date(),
        },
      })
      savedConnectionId = existingConnection.id
    } else {
      // Create new connection
      const createData = {
        userId: user.id,
        platform,
        appType: connectionAppType,
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : null,
        tokenExpiry: tokenExpiry,
        platformUserId,
        platformUsername,
        isActive: true,
        lastUsed: new Date(),
      }

      try {
        let createdConnection
        if (appTypeColumnAvailable === false) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { appType: _appType, ...legacyData } = createData
          createdConnection = await prisma.socialConnection.create({
            data: legacyData,
          })
        } else {
          createdConnection = await prisma.socialConnection.create({
            data: createData,
          })
          appTypeColumnAvailable = true
        }
        savedConnectionId = createdConnection.id
      } catch (createError: unknown) {
        if (isAppTypeColumnError(createError)) {
          console.warn('[LinkedIn OAuth] appType column not available, creating connection without appType (migration not applied yet)')
          appTypeColumnAvailable = false
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { appType: _appType, ...legacyData } = createData
          const createdConnection = await prisma.socialConnection.create({
            data: legacyData,
          })
          savedConnectionId = createdConnection.id
        } else {
          throw createError
        }
      }
    }

    // For Instagram, fetch the actual username in the background if we don't have it yet
    if (platform === 'instagram' && savedConnectionId && (!platformUsername || platformUsername === 'Instagram User')) {
      const fetchParams = (request as RequestWithInstagramParams).__instagramFetchParams
      if (fetchParams) {
        // Fire and forget - fetch username asynchronously without blocking the redirect
        // Use user token from fetchParams (we have it from OAuth), or from refreshToken if stored
        const userTokenToUse = fetchParams.userAccessToken || (refreshToken ? decrypt(refreshToken) : null)
        const tokenToUse = userTokenToUse || fetchParams.pageAccessToken
        const tokenType = userTokenToUse ? 'user' : 'page'

        fetchInstagramUsernameUtil(
          savedConnectionId,
          tokenToUse,
          fetchParams.instagramAccountId,
          tokenType
        ).then(async (username) => {
          if (username) {
            // Update connection with fetched username
            await prisma.socialConnection.update({
              where: { id: savedConnectionId },
              data: {
                platformUsername: username,
              },
            })
            console.log('[Instagram OAuth] Successfully updated username in background:', username)
          }
        }).catch((error) => {
          console.error('[Instagram OAuth] Failed to fetch username in background:', error)
        })
      }
    }

    // Log connection details for debugging
    if (platform === 'linkedin') {
      const scopes = (tokenData?.scope as string)?.split(' ') || []
      const hasOrganizationScope = scopes.includes('w_organization_social') || scopes.includes('r_organization_admin') || scopes.includes('rw_organization_admin')
      console.log('[LinkedIn OAuth] Connection saved', {
        appType: connectionAppType,
        scopes: scopes,
        hasOrganizationScope,
        targetType,
        isCompanyCallback,
      })
    }

    // Redirect back to settings page
    return redirectWithCleanup('/settings?connected=true')
  } catch (error) {
    console.error('Error handling OAuth callback:', error)
    const response = NextResponse.redirect(new URL('/settings?error=oauth_failed', request.url))
    response.cookies.delete('oauth_state_twitter')
    response.cookies.delete('oauth_state_linkedin')
    response.cookies.delete('oauth_state_facebook')
    response.cookies.delete('oauth_state_instagram')
    response.cookies.delete('oauth_state_threads')
    return response
  }
}
