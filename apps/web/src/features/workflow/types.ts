export type StepStatus = 'pending' | 'running' | 'completed' | 'failed'

export type PipelineStep = {
  stepNumber: number
  stepName: string
  status: StepStatus
  cost?: number | null
  duration?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  completedAt?: string | null
  errorMessage?: string | null
  output?: string | null
}

export type ErrorLog = {
  id: string
  errorType: string
  errorMessage: string
  createdAt: string
}

export type OutputAttempt = {
  id: string
  target: string
  status: 'pending' | 'success' | 'failed'
  resultUrl?: string | null
  errorMessage?: string | null
  startedAt: string
  completedAt?: string | null
  durationMs?: number | null
}

export type FeaturedImage = {
  id: string
  url: string
  altText?: string | null
}

export type CitationEntry = {
  link_title?: string
  link_url?: string
  linkTitle?: string
  linkUrl?: string
  title?: string
  url?: string
  href?: string
  link_href?: string
  sourceTitle?: string  // legacy prompt format (pre-v3 reseed)
  sourceUrl?: string    // legacy prompt format (pre-v3 reseed)
}

export type ArticleDiagram = {
  id: string
  position: number
  sectionTitle: string
  caption?: string | null
  svgCdnUrl?: string | null
  /** Format the download route serves: branded restyled/plain PNG, SVG fallback. */
  downloadExt?: 'png' | 'svg'
}

export type SitePage = {
  id: string
  title: string
  slug: string
  seoTitle?: string | null
  seoDescription?: string | null
  primaryKeyword?: string | null
  readingTime?: number | null
  enrichmentStatus?: string | null
  enrichmentError?: string | null
  excerpt?: string | null
  disclaimer?: string | null
  bodyHtml?: string | null
  citations?: unknown
  /** JSON-LD from Step 16 / approval — may be null if generation failed */
  schemaJson?: string | null
  featuredImage?: FeaturedImage | null
  diagrams?: ArticleDiagram[]
}

export type ArticleJob = {
  id: string
  status: string
  currentStep: number
  totalCost: number
  totalTokens: number
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  approvedAt?: string | null
  topic: { topic: string; mode: string; slug?: string | null }
  pipelineSteps: PipelineStep[]
  /** Some API payloads use `steps` — normalize in fetchJob into pipelineSteps */
  steps?: PipelineStep[]
  sitePage?: SitePage | null
  errorLogs: ErrorLog[]
}

export type SSEUpdate = {
  type: 'update' | 'done' | 'error'
  status?: string
  currentStep?: number
  totalCost?: number
  totalTokens?: number
  steps?: PipelineStep[]
  message?: string
}

export type BrandSettings = {
  defaultAuthorName?: string | null
  defaultAuthorWebsite?: string | null
  defaultAuthorLinkedIn?: string | null
  ourExperience?: string | null
}

export type WpConnectionLite = {
  id: string
  label: string
  siteUrl: string
}

export type SyndicationArticle = { platform: string; title: string; content: string; status: string; errorMessage?: string | null }
