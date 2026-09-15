import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { currentUser } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { generateOAuthState } from '@/lib/oauth'
import { createHash } from 'crypto'

// Valid platform names
const VALID_PLATFORMS = ['linkedin', 'twitter', 'facebook', 'instagram', 'threads']

type OAuthStateCookieData = {
  state: string
  codeVerifier?: string
  target?: 'personal' | 'company'
}

// OAuth configuration
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID
// LINKEDIN_CLIENT_SECRET is used in callback route
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/social/linkedin/callback`

// LinkedIn Company Pages App (separate app for Community Management API)
const LINKEDIN_COMPANY_CLIENT_ID = process.env.LINKEDIN_COMPANY_CLIENT_ID
// LINKEDIN_COMPANY_CLIENT_SECRET is used in callback route
// Note: Company callback uses same path as personal (target is stored in OAuth state, not query param)
// LinkedIn doesn't preserve query parameters in callback URLs, so we use OAuth state to track target
const LINKEDIN_COMPANY_REDIRECT_URI = process.env.LINKEDIN_COMPANY_REDIRECT_URI || 
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/social/linkedin/callback`

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID
// TWITTER_CLIENT_SECRET is used in callback route
const TWITTER_REDIRECT_URI = process.env.TWITTER_REDIRECT_URI || 
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/social/twitter/callback`

const FACEBOOK_CLIENT_ID = process.env.FACEBOOK_CLIENT_ID
// FACEBOOK_CLIENT_SECRET is used in callback route
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/social/facebook/callback`

const INSTAGRAM_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID || process.env.FACEBOOK_CLIENT_ID // Instagram uses Facebook OAuth
// INSTAGRAM_CLIENT_SECRET is used in callback route
const INSTAGRAM_REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI || 
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/social/instagram/callback`

// Threads requires its own Client ID and Secret (separate from Facebook)
// Threads OAuth uses threads.net domain and requires a Threads-specific app
// IMPORTANT: Threads OAuth REQUIRES HTTPS - cannot use HTTP even for localhost
// THREADS_CLIENT_ID and THREADS_CLIENT_SECRET are used in callback route
// For local development, you must use an HTTPS URL (e.g., ngrok: https://your-domain.ngrok.io)
// Or set THREADS_REDIRECT_URI environment variable with your HTTPS URL
const getThreadsRedirectUri = () => {
  if (process.env.THREADS_REDIRECT_URI) {
    return process.env.THREADS_REDIRECT_URI
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  // Check if base URL uses HTTPS
  if (baseUrl.startsWith('https://')) {
    return `${baseUrl}/api/social/threads/callback`
  }
  // For HTTP localhost, return a placeholder that will trigger an error with helpful message
  return `${baseUrl}/api/social/threads/callback`
}
const THREADS_REDIRECT_URI = getThreadsRedirectUri()

// Helper function to get or create user
async function getOrCreateUser(clerkId: string) {
  let user = await prisma.user.findUnique({
    where: { clerkId },
  })

  if (!user) {
    const clerkUser = await currentUser()
    
    if (!clerkUser) {
      throw new Error('User not found in Clerk')
    }

    const email = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress

    if (!email) {
      throw new Error('No email found')
    }

    const name = clerkUser.firstName
      ? `${clerkUser.firstName}${clerkUser.lastName ? ' ' + clerkUser.lastName : ''}`
      : email.split('@')[0]

    user = await prisma.user.create({
      data: {
        clerkId,
        name,
        email,
      },
    })
  }

  return user
}

type RouteContext = {
  params: Promise<{
    platform: string
  }>
}

// POST /api/social/[platform] - Initiate OAuth flow
export async function POST(
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

    // Generate OAuth state token and determine redirect URL
    let redirectUrl: string
    let state: string
    let codeVerifier: string
    let stateTarget: 'personal' | 'company' | undefined

    if (platform === 'linkedin') {
      // Check if this is for Company Pages (passed as query parameter)
      const requestUrl = new URL(request.url)
      const target = requestUrl.searchParams.get('target') // 'company' or 'personal' (default)
      const isCompanyPage = target === 'company'
      const targetType: 'personal' | 'company' = isCompanyPage ? 'company' : 'personal'
      stateTarget = targetType
      
      console.log(`[LinkedIn OAuth] Initiating OAuth flow`, {
        target,
        isCompanyPage,
        targetType,
        clerkId,
      })
      
      // Generate OAuth state token with target type stored in state
      const stateData = await generateOAuthState(clerkId, platform, targetType)
      state = stateData.state
      codeVerifier = stateData.codeVerifier
      
      console.log(`[LinkedIn OAuth] Generated state token`, {
        state: state.substring(0, 16) + '...',
        targetType,
      })
      
      // Select appropriate app credentials
      const clientId = isCompanyPage ? LINKEDIN_COMPANY_CLIENT_ID : LINKEDIN_CLIENT_ID
      const redirectUri = isCompanyPage ? LINKEDIN_COMPANY_REDIRECT_URI : LINKEDIN_REDIRECT_URI
      
      if (!clientId) {
        const appType = isCompanyPage ? 'Company Pages' : 'Personal Profile'
        return NextResponse.json(
          { error: `LinkedIn ${appType} OAuth not configured. Please set LINKEDIN${isCompanyPage ? '_COMPANY' : ''}_CLIENT_ID environment variable.` },
          { status: 500 }
        )
      }

      // LinkedIn OAuth 2.0 authorization URL
      // Note:
      // - Personal Profiles: still rely on w_member_social ("Share on LinkedIn" product)
      // - Company Pages: require Community Management API approval and LinkedIn expects w_organization_social +
      //   r_organization_social + r_organization_admin to cover posting, analytics, and admin lookups
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        // Request appropriate scopes based on target
        scope: isCompanyPage 
          ? 'w_organization_social r_organization_social rw_organization_admin'  // Company Pages - Community Management API doesn't support OpenID Connect scopes
          : 'openid profile email w_member_social',       // Personal Profiles
      })

      redirectUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
    } else {
      // Generate OAuth state token for other platforms
      const stateData = await generateOAuthState(clerkId, platform)
      state = stateData.state
      codeVerifier = stateData.codeVerifier

      if (platform === 'twitter') {
        if (!TWITTER_CLIENT_ID) {
          return NextResponse.json(
            { error: 'Twitter/X OAuth not configured. Please set TWITTER_CLIENT_ID environment variable.' },
            { status: 500 }
          )
        }

        // Twitter OAuth 2.0 authorization URL
        const codeChallenge = createHash('sha256')
          .update(codeVerifier)
          .digest('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: TWITTER_CLIENT_ID,
          redirect_uri: TWITTER_REDIRECT_URI,
          state,
          scope: 'tweet.read tweet.write users.read offline.access media.write', // Required scopes for posting and media uploads
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        })

        redirectUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`
      } else if (platform === 'facebook') {
        if (!FACEBOOK_CLIENT_ID) {
          return NextResponse.json(
            { error: 'Facebook OAuth not configured. Please set FACEBOOK_CLIENT_ID environment variable.' },
            { status: 500 }
          )
        }

        // Facebook OAuth 2.0 authorization URL
        // Scopes for "Manage everything on your Page" use case:
        // - public_profile: Required for Facebook Login
        // - business_management: Required for Page management use case
        // - pages_show_list: Required to list user's Pages
        // - pages_manage_posts: Required to post to Pages
        // - pages_read_engagement: Required for Page analytics
        // Note: The "Manage everything on your Page" use case must be added to your app
        // Note: These permissions may require App Review for production use
        const params = new URLSearchParams({
          client_id: FACEBOOK_CLIENT_ID,
          redirect_uri: FACEBOOK_REDIRECT_URI,
          state,
          scope: 'public_profile,business_management,pages_show_list,pages_manage_posts,pages_read_engagement',
          response_type: 'code',
        })

        redirectUrl = `https://www.facebook.com/v24.0/dialog/oauth?${params.toString()}`
      } else if (platform === 'instagram') {
        if (!INSTAGRAM_CLIENT_ID) {
          return NextResponse.json(
            { error: 'Instagram OAuth not configured. Please set INSTAGRAM_CLIENT_ID or FACEBOOK_CLIENT_ID environment variable.' },
            { status: 500 }
          )
        }

        // Instagram OAuth 2.0 authorization URL (uses Facebook OAuth)
        // Scopes for Instagram Business Account posting (Instagram Graph API):
        // - pages_show_list: Required to list Facebook Pages connected to Instagram Business Accounts
        // - pages_read_engagement: Required for reading engagement metrics
        // - instagram_content_publish: Required for publishing content to Instagram (Instagram Graph API)
        // - instagram_basic: Required for reading profile metadata of Business accounts (Instagram Graph API)
        // - business_management: Required for managing business accounts
        // NOTE: instagram_basic and instagram_content_publish are both from Instagram Graph API and are compatible.
        // The Basic Display API (deprecated) uses user_profile and user_media scopes, which are different.
        const params = new URLSearchParams({
          client_id: INSTAGRAM_CLIENT_ID,
          redirect_uri: INSTAGRAM_REDIRECT_URI,
          state,
          scope: 'pages_show_list,pages_read_engagement,instagram_content_publish,instagram_basic,business_management',
          response_type: 'code',
        })

        redirectUrl = `https://www.facebook.com/v24.0/dialog/oauth?${params.toString()}`
      } else if (platform === 'threads') {
        // Threads requires its own Client ID (cannot use Facebook Client ID)
        // Threads OAuth uses threads.net domain and requires a Threads-specific app
        const threadsClientId = process.env.THREADS_CLIENT_ID
        if (!threadsClientId) {
          console.error('[Threads OAuth] THREADS_CLIENT_ID not set in environment variables')
          return NextResponse.json(
            { error: 'Threads OAuth not configured. Please set THREADS_CLIENT_ID environment variable. Note: Threads requires a separate app ID from Facebook.' },
            { status: 500 }
          )
        }

        // Threads OAuth REQUIRES HTTPS - check if redirect URI uses HTTPS
        if (!THREADS_REDIRECT_URI.startsWith('https://')) {
          console.error('[Threads OAuth] Redirect URI must use HTTPS:', THREADS_REDIRECT_URI)
          return NextResponse.json(
            { 
              error: 'Threads OAuth requires HTTPS. For local development, please:\n' +
                     '1. Use ngrok or similar tool to create an HTTPS tunnel (e.g., https://your-domain.ngrok.io)\n' +
                     '2. Set THREADS_REDIRECT_URI environment variable to your HTTPS URL\n' +
                     '3. Add the HTTPS redirect URI to your Threads app settings in Meta Developer Console\n' +
                     'Current redirect URI: ' + THREADS_REDIRECT_URI
            },
            { status: 500 }
          )
        }

        console.log('[Threads OAuth] Initiating OAuth flow', {
          clientId: threadsClientId.substring(0, 10) + '...',
          redirectUri: THREADS_REDIRECT_URI,
        })

        // Threads OAuth 2.0 authorization URL
        // IMPORTANT: Threads has its own separate OAuth gateway at threads.net (not facebook.com)
        // Required scopes:
        // - threads_basic: Required to know who the user is
        // - threads_content_publish: Required to post content to Threads
        // NOTE: Threads uses threads.net domain for OAuth, not facebook.com
        const params = new URLSearchParams({
          client_id: threadsClientId,
          redirect_uri: THREADS_REDIRECT_URI,
          scope: 'threads_basic,threads_content_publish',
          response_type: 'code',
          state,
        })

        // Try threads.net first (as per guidance), but Threads might redirect to threads.com
        const oauthUrl = `https://threads.net/oauth/authorize?${params.toString()}`
        console.log('[Threads OAuth] Generated OAuth URL (first 150 chars):', oauthUrl.substring(0, 150))
        console.log('[Threads OAuth] Full params:', {
          client_id: threadsClientId ? threadsClientId.substring(0, 10) + '...' : 'MISSING',
          redirect_uri: THREADS_REDIRECT_URI,
          scope: 'threads_basic,threads_content_publish',
          response_type: 'code',
          has_state: !!state,
        })
        redirectUrl = oauthUrl
      } else {
        return NextResponse.json(
          { error: `Unsupported platform: ${platform}` },
          { status: 400 }
        )
      }
    }

    const response = NextResponse.json({
      redirectUrl,
      platform,
    })

    try {
      const cookieName = `oauth_state_${platform}`
      const cookieData: OAuthStateCookieData = { state }
      if (platform === 'twitter' && codeVerifier) {
        cookieData.codeVerifier = codeVerifier
      }
      if (stateTarget) {
        cookieData.target = stateTarget
      }

      response.cookies.set({
        name: cookieName,
        value: JSON.stringify(cookieData),
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 10 * 60, // 10 minutes
        path: '/',
      })
    } catch (cookieError) {
      console.warn('Failed to set OAuth state cookie:', cookieError)
    }

    return response
  } catch (error) {
    console.error('Error initiating OAuth flow:', error)
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 }
    )
  }
}

// DELETE /api/social/[platform] - Disconnect platform
export async function DELETE(
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

    const user = await getOrCreateUser(clerkId)

    // Find and delete the connection(s)
    // For LinkedIn, delete both personal and company connections
    // For other platforms, delete the single connection
    if (platform === 'linkedin') {
      // Delete all LinkedIn connections (both personal and company)
      const deleted = await prisma.socialConnection.deleteMany({
        where: {
          userId: user.id,
          platform,
        },
      })
      
      if (deleted.count === 0) {
        return NextResponse.json(
          { error: 'Connection not found' },
          { status: 404 }
        )
      }
    } else {
      interface PrismaError extends Error {
        code?: string
        message: string
      }

      // For other platforms, delete the single connection (appType is null)
      // Handle case where unique constraint doesn't exist yet (before migration)
      let connection = null
      try {
        connection = await prisma.socialConnection.findUnique({
          where: {
            userId_platform_appType: {
              userId: user.id,
              platform,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              appType: null as any,
            },
          },
        })
      } catch (error: unknown) {
        const prismaError = error as PrismaError
        // If unique constraint doesn't exist yet, use findFirst
        if (prismaError.message?.includes('userId_platform_appType') || 
            prismaError.message?.includes('Unknown argument') ||
            prismaError.code === 'P2009') {
          connection = await prisma.socialConnection.findFirst({
            where: {
              userId: user.id,
              platform,
            },
          })
        } else {
          throw error
        }
      }

      if (!connection) {
        return NextResponse.json(
          { error: 'Connection not found' },
          { status: 404 }
        )
      }

      await prisma.socialConnection.delete({
        where: { id: connection.id },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error disconnecting platform:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect platform' },
      { status: 500 }
    )
  }
}

