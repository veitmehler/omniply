import type { Metadata } from 'next'
import { SiteHeader, Section, SectionHead, Measure, P, MarketingFooter } from '@/components/marketing/Marketing'

export const revalidate = 300

const DO_API_BASE = process.env.DO_API_BASE ?? 'https://svc.omniply.io'

export const metadata: Metadata = {
  title: 'Articles... Omniply',
  description: 'Articles on practice marketing, written and published by the same engine Omniply customers get.',
}

interface ArticleCard {
  slug: string
  title: string
  excerpt: string | null
  readingTime: number | null
  publishedAt: string
  featuredImage: string | null
}

async function fetchArticles(): Promise<ArticleCard[]> {
  try {
    const res = await fetch(`${DO_API_BASE}/api/articles-public?limit=50`, { next: { revalidate: 300 } })
    if (!res.ok) return []
    const data = (await res.json()) as { articles: ArticleCard[] }
    return data.articles ?? []
  } catch {
    return []
  }
}

export default async function ArticlesIndexPage() {
  const articles = await fetchArticles()
  return (
    <main className="om">
      <SiteHeader />
      <Section tone="grey">
        <SectionHead
          eyebrow="Articles"
          title="Articles from the engine room."
          lead="Every article here was researched, written, illustrated, and published by the same engine our customers get. We do not just sell the autopilot... we fly it. Judge us by the output."
        />
        <Measure style={{ marginTop: 40, display: 'grid', gap: 16 }}>
          {articles.length === 0 && <P center>First articles landing shortly.</P>}
          {articles.map((a) => (
            <a key={a.slug} href={`/articles/${a.slug}`} className="om-card" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              {a.featuredImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.featuredImage}
                  alt=""
                  className="hidden md:block"
                  style={{ width: 144, height: 96, flex: 'none', borderRadius: 12, objectFit: 'cover' }}
                />
              )}
              <div>
                <h3 className="om-h3">{a.title}</h3>
                {a.excerpt && <p className="om-p">{a.excerpt}</p>}
                <p className="om-small" style={{ marginTop: 12 }}>
                  {new Date(a.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {a.readingTime ? ` · ${a.readingTime} min read` : ''}
                </p>
              </div>
            </a>
          ))}
        </Measure>
      </Section>
      <MarketingFooter />
    </main>
  )
}
