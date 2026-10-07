import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SiteHeader, MarketingFooter, TOKENS } from '@/components/marketing/Marketing'
import { DiagramLightbox } from '../DiagramLightbox'
import '../../article-typography.css'
import '../article-marketing.css'

export const revalidate = 300

const DO_API_BASE = process.env.DO_API_BASE ?? 'https://svc.omniply.io'
const PUBLIC_BASE = 'https://omniply.io'

interface PublicArticle {
  slug: string
  title: string
  seoTitle: string
  seoDescription: string
  excerpt: string | null
  bodyHtml: string
  disclaimer: string | null
  schemaJson: string | null
  readingTime: number | null
  publishedAt: string
  primaryKeyword: string | null
  citations: unknown
  featuredImage: { url: string; width: number | null; height: number | null; alt: string } | null
}

async function fetchArticle(slug: string): Promise<PublicArticle | null> {
  try {
    const res = await fetch(`${DO_API_BASE}/api/articles-public/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    })
    if (!res.ok) return null
    return (await res.json()) as PublicArticle
  } catch {
    return null
  }
}

interface SourceLink {
  link_title: string
  link_url: string
}

/** Normalize the citations JSON (two-tier / legacy dict / plain array). */
function normalizeSources(citations: unknown): { references: SourceLink[]; inline: SourceLink[] } {
  const asLinks = (v: unknown): SourceLink[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((x) => ({ link_title: String(x.link_title ?? x.link_url ?? ''), link_url: String(x.link_url ?? '') }))
          .filter((x) => x.link_url.startsWith('http'))
      : []
  if (Array.isArray(citations)) return { references: asLinks(citations), inline: [] }
  if (citations && typeof citations === 'object') {
    const c = citations as Record<string, unknown>
    const references = asLinks(c.resource_links)
    const refUrls = new Set(references.map((r) => r.link_url))
    // Dedupe inline sources against the curated references and themselves.
    const seen = new Set<string>()
    const inline = asLinks(c.inline_sources).filter((x) => {
      if (refUrls.has(x.link_url) || seen.has(x.link_url)) return false
      seen.add(x.link_url)
      return true
    })
    return { references, inline }
  }
  return { references: [], inline: [] }
}

function SourcesBox({ citations }: { citations: unknown }) {
  // Curated Tier-2 references only (user-locked): inline grounding
  // citations already appear as links inside the article body.
  const { references } = normalizeSources(citations)
  if (references.length === 0) return null
  return (
    <div className="sources-box">
      <details>
        <summary>Sources &amp; References</summary>
        <ul>
          {references.map((r) => (
            <li key={r.link_url}>
              <a href={r.link_url} target="_blank" rel="noopener nofollow">{r.link_title || r.link_url}</a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const article = await fetchArticle(slug)
  if (!article) return { title: 'Article not found... Omniply' }
  return {
    title: `${article.seoTitle}... Omniply`,
    description: article.seoDescription,
    alternates: { canonical: `${PUBLIC_BASE}/articles/${article.slug}` },
    openGraph: {
      title: article.seoTitle,
      description: article.seoDescription,
      type: 'article',
      url: `${PUBLIC_BASE}/articles/${article.slug}`,
      publishedTime: article.publishedAt,
      ...(article.featuredImage ? { images: [{ url: article.featuredImage.url, alt: article.featuredImage.alt }] } : {}),
    },
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await fetchArticle(slug)
  if (!article) notFound()

  const category = article.primaryKeyword
    ? article.primaryKeyword.replace(/\b\w/g, (c: string) => c.toUpperCase())
    : 'Practice Marketing'

  return (
    <main
      className="marketing-article"
      style={
        {
          background: '#fff',
          // .article-body colors itself with the app-theme vars — define them
          // here so marketing pages render dark-on-light regardless of the
          // app globals.
          '--card-foreground': '#1C2B36',
          '--border': '#E2E7EB',
          '--muted-foreground': '#55636E',
          '--card': '#F4F7F9',
          '--muted': '#EDF1F4',
          '--primary': '#5F8A14',
        } as React.CSSProperties
      }
    >
      <SiteHeader />
      {/* ── Hero: featured image ground + navy 0.72 overlay + white title/meta ── */}
      <section
        className="relative flex min-h-[380px] items-end md:min-h-[460px]"
        style={{
          backgroundImage: article.featuredImage
            ? `linear-gradient(rgba(5,34,52,0.72), rgba(5,34,52,0.72)), url(${article.featuredImage.url})`
            : `linear-gradient(180deg, ${TOKENS.ink}, ${TOKENS.inkDeep})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="mx-auto w-full max-w-[1024px] px-5 pb-12 pt-32 md:px-8">
          <div className="mb-3 text-sm font-bold uppercase tracking-[0.16em]" style={{ color: TOKENS.lime }}>
            {category}
          </div>
          <h1
            className="text-4xl font-bold leading-tight text-white md:text-5xl"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            {article.title}
          </h1>
          <div className="mt-5 text-[15px] text-white/75">
            {new Date(article.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            {article.readingTime ? ` · ${article.readingTime} min read` : ''} · by the Omniply content engine, reviewed by a human
          </div>
        </div>
      </section>
      <article className="mx-auto w-full max-w-[1024px] px-5 py-14 md:px-8">
        <div className="article-body" dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />
        <SourcesBox citations={article.citations} />
        {article.disclaimer && (
          <p className="mt-12 border-t pt-6 text-sm italic" style={{ color: TOKENS.muted, borderColor: TOKENS.line }}>
            {article.disclaimer}
          </p>
        )}
      </article>
      {article.schemaJson && (
        // <-escape at render too (not just in the builder): rows stored
        // before the builder escaped could still carry "</script>".
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: article.schemaJson.replace(/</g, '\\u003c') }}
        />
      )}
      <MarketingFooter />
      <DiagramLightbox />
    </main>
  )
}
