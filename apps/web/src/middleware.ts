import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Canonical app host is env-driven (flips to chiro.omniply.io in the rename's
// Phase 3); BOTH omniply and legacy socioply hosts serve during the transition.
const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST ?? 'chiro.omniply.io'
// Vertical subdomains (.plans/vertical-platform.implementation-plan.md V1):
// each vertical's app lives on its own subdomain — same deployment, the host
// is branding. This map is the single registry future per-vertical surfaces
// (marketing pages, sign-up context) read from.
export const HOST_VERTICALS: Record<string, string> = {
  'chiro.omniply.io': 'chiro',
  'staging.chiro.omniply.io': 'chiro',
  'app.socioply.com': 'chiro',
  'azavea.omniply.io': 'azavea',
}
const APP_HOSTS = new Set([APP_HOST, ...Object.keys(HOST_VERTICALS)])
// Marketing hosts serve the public sales pages (apex omniply.io + www; legacy www.socioply).
const MARKETING_HOSTS = new Set(['omniply.io', 'www.omniply.io', 'www.socioply.com'])
const WWW_HOST = 'www.socioply.com'

// Routes that belong exclusively to the authenticated app (not the marketing site)
const APP_PATHS = [
  '/dashboard',
  '/posts',
  '/workflow',
  '/images',
  '/calendar',
  '/account',
  '/settings',
  '/templates',
  '/sign-in',
  '/sign-up',
]

// Public routes on the app domain that don't require Clerk authentication
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/posts/publish-scheduled',
  '/api/posts/sync-analytics',
  // Embedded GHL surface: authenticated by the SSO-derived embed token, not
  // Clerk (onboarding plan Phase 0).
  '/embed(.*)',
  // Public marketing pages (reviewable on any host).
  '/home(.*)',
  '/chiropractors(.*)',
  '/about(.*)',
  '/contact(.*)',
  '/data-security(.*)',
  '/terms(.*)',
  '/privacy(.*)',
  '/refund-policy(.*)',
  '/articles(.*)',
  '/api/marketing-contact',
  // Practice X-Ray funnel (static pages in public/, clean URLs via rewrites).
  '/x-ray(.*)',
  '/walkthrough(.*)',
  // Chat-agent widget test page (unlisted, noindex; loads the STAGING agent).
  '/agent-test(.*)',
])

function isOmniplyDomain(host: string) {
  return host === APP_HOST || host === WWW_HOST
}

/** Marketing hosts never touch Clerk — pure public pages, no session handshake. */
function marketingResponse(request: Request & { nextUrl: URL }) {
  const { pathname } = request.nextUrl
  if (pathname === '/') {
    const url = new URL(request.url)
    url.pathname = '/home'
    return NextResponse.rewrite(url)
  }
  const isAppPath = APP_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  if (isAppPath) {
    const url = new URL(request.url)
    url.host = APP_HOST
    return NextResponse.redirect(url, 301)
  }
  return NextResponse.next()
}

const withClerk = clerkMiddleware(async (auth, request) => {
  const host = request.headers.get('host') ?? ''
  const { pathname } = request.nextUrl

  // ── Domain routing (production only — skipped on localhost / preview URLs) ──
  if (isOmniplyDomain(host)) {
    if (host === WWW_HOST) {
      // www only serves the marketing site. Any app path → redirect to app domain.
      const isAppPath = APP_PATHS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      )
      if (isAppPath) {
        const url = new URL(request.url)
        url.host = APP_HOST
        return NextResponse.redirect(url, 301)
      }
      // Legacy www marketing host (still Clerk-wrapped; harmless).
      return NextResponse.next()
    }

    if (APP_HOSTS.has(host)) {
      // app domain: root path → redirect to dashboard
      if (pathname === '/') {
        const url = new URL(request.url)
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
      }
    }
  }

  // ── Clerk auth protection (applies on app domain + localhost) ──
  // API routes are explicitly excluded: each handler calls auth() itself and
  // returns a JSON 401. Letting auth.protect() intercept /api/* would make
  // Clerk return an HTML error page on auth failures, causing SyntaxErrors on
  // the client and masking real 401s as confusing 404s.
  const isApiRoute = pathname.startsWith('/api/')
  if (!isPublicRoute(request) && !isApiRoute) {
    await auth.protect()
  }
})

export default function middleware(request: Parameters<typeof withClerk>[0], event: Parameters<typeof withClerk>[1]) {
  const host = request.headers.get('host') ?? ''
  if (MARKETING_HOSTS.has(host)) return marketingResponse(request)
  // GHL iframe surface: authenticated by the SSO-derived embed bearer, never
  // Clerk. Skipping clerkMiddleware entirely prevents its cookie "handshake"
  // redirect from ever bouncing the iframe document to a sign-in page (seen
  // 2026-09-21 when an expired ADMIN Clerk session lingered in the browser).
  if (request.nextUrl.pathname.startsWith('/embed')) {
    return NextResponse.next()
  }
  // Embed-bearer API calls (GHL client shell): Clerk's middleware chokes on
  // the non-Clerk JWT in the Authorization header (MIDDLEWARE_INVOCATION_
  // FAILED) — and has nothing to add: these requests authenticate in the
  // route handlers via resolveClerkId(). Skip Clerk entirely.
  if (
    request.nextUrl.pathname.startsWith('/api/') &&
    (request.headers.get('authorization') ?? '').startsWith('Bearer emb_')
  ) {
    return NextResponse.next()
  }
  return withClerk(request, event)
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
