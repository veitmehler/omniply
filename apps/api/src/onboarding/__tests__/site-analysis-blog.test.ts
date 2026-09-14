import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@omniply/shared', () => ({ prisma: {} }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../article-pipeline/enrichment/diagram-browser-pool', () => ({ withRasterPage: vi.fn() }))
vi.mock('../../lib/net/instrument', () => ({ instrumentCall: vi.fn((_m: unknown, fn: () => unknown) => fn()) }))
// The SSRF guard does real DNS; these tests use fake domains with a mocked
// fetch. The guard itself is covered by lib/__tests__/ssrf.test.ts.
vi.mock('../../lib/ssrf', () => ({ assertSafePublicUrl: vi.fn(async () => {}) }))

import { crawlSite } from '../site-analysis'

const WORDS_500 = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
const WORDS_100 = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')

type Route = { body: string; contentType?: string; status?: number }

function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input).replace(/\/$/, '')
      const route = routes[url]
      if (!route) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
      return new Response(route.body, {
        status: route.status ?? 200,
        headers: { 'content-type': route.contentType ?? 'text/html' },
      })
    }),
  )
}

const HOME = '<html><head><title>Test Clinic</title></head><body><a href="/blog">Blog</a></body></html>'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('crawlSite blog discovery', () => {
  it('uses the WordPress REST fast path when available', async () => {
    stubFetch({
      'https://clinic.test': { body: HOME },
      'https://clinic.test/wp-json/wp/v2/posts?per_page=3&orderby=date&_fields=title,content,link': {
        body: JSON.stringify([
          {
            title: { rendered: 'My Real Post' },
            content: { rendered: `<p>${WORDS_500}</p>` },
            link: 'https://clinic.test/blog/my-real-post',
          },
        ]),
        contentType: 'application/json',
      },
    })
    const result = await crawlSite('https://clinic.test')
    expect(result.blogArticle).toBeDefined()
    expect(result.blogArticle?.title).toBe('My Real Post')
    expect(result.blogArticle?.url).toBe('https://clinic.test/blog/my-real-post')
    expect(result.blogArticle?.wordCount).toBeGreaterThanOrEqual(400)
  })

  it('falls back to the HTML listing when WP REST is absent', async () => {
    stubFetch({
      'https://clinic.test': { body: HOME },
      'https://clinic.test/blog': {
        body: '<html><body><a href="/blog/first-post">First post</a></body></html>',
      },
      'https://clinic.test/blog/first-post': {
        body: `<html><head><title>First Post | Test Clinic</title></head><body><article><p>${WORDS_500}</p></article></body></html>`,
      },
    })
    const result = await crawlSite('https://clinic.test')
    expect(result.blogArticle?.url).toBe('https://clinic.test/blog/first-post')
    expect(result.blogArticle?.title).toBe('First Post')
    expect(result.blogArticle?.wordCount).toBeGreaterThanOrEqual(400)
  })

  it('rejects posts under 400 words', async () => {
    stubFetch({
      'https://clinic.test': { body: HOME },
      'https://clinic.test/wp-json/wp/v2/posts?per_page=3&orderby=date&_fields=title,content,link': {
        body: JSON.stringify([
          { title: { rendered: 'Stub' }, content: { rendered: `<p>${WORDS_100}</p>` }, link: 'https://clinic.test/blog/stub' },
        ]),
        contentType: 'application/json',
      },
    })
    const result = await crawlSite('https://clinic.test')
    expect(result.blogArticle).toBeUndefined()
  })

  it('returns no article for a site without a blog', async () => {
    stubFetch({
      'https://clinic.test': { body: '<html><head><title>T</title></head><body><a href="/about">About</a></body></html>' },
    })
    const result = await crawlSite('https://clinic.test')
    expect(result.blogArticle).toBeUndefined()
  })
})
