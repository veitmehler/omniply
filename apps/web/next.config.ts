import type { NextConfig } from 'next'

// GHL domains allowed to iframe the /embed surface (onboarding plan Phase 0).
// EMBED_FRAME_ANCESTORS env extends this with the whitelabel domain(s).
const FRAME_ANCESTORS = [
  "'self'",
  'https://app.gohighlevel.com',
  'https://*.gohighlevel.com',
  'https://crm.omniply.io', // Omniply whitelabel portal
  ...(process.env.EMBED_FRAME_ANCESTORS?.split(/\s+/).filter(Boolean) ?? []),
].join(' ')

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async rewrites() {
    // Marketing funnel pages are self-contained static files in public/ —
    // rewrites give them clean URLs.
    return [
      { source: '/x-ray', destination: '/x-ray/index.html' },
      { source: '/walkthrough', destination: '/walkthrough/index.html' },
      { source: '/intro/wellness', destination: '/intro/wellness/index.html' },
      { source: '/intro/chiropractors', destination: '/intro/chiropractors/index.html' },
    ]
  },
  async headers() {
    return [
      {
        // Only the embed surface may be framed — the rest of the app keeps
        // browser defaults (Clerk-protected open web).
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${FRAME_ANCESTORS}` },
        ],
      },
    ]
  },
  devIndicators: {
    position: 'bottom-left',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        // CloudFront CDN for user-uploaded and AI-generated images
        protocol: 'https',
        hostname: 'cdn.socioply.com',
      },
      {
        // CloudFront raw domain as fallback (e.g. before custom domain DNS propagates)
        protocol: 'https',
        hostname: 'd1qg5yy88wla4h.cloudfront.net',
      },
    ],
  },
}

export default nextConfig
