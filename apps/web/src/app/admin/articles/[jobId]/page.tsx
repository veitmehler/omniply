import { prisma } from '@omniply/shared'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { PollRefresh } from './PollRefresh'
import { ReleaseButton } from './ReleaseButton'

/** Total number of prompt-template steps in the full pipeline (Phase A + B). */
const TOTAL_PIPELINE_STEPS = 25

const ACTIVE_JOB_STATUSES = new Set(['pending', 'in_progress', 'completed', 'approved'])

const CDN_BASE = process.env.CDN_BASE ?? process.env.NEXT_PUBLIC_CDN_BASE ?? ''

function cdnUrl(s3Key: string | null | undefined): string | null {
  if (!s3Key) return null
  return `${CDN_BASE.replace(/\/$/, '')}/${s3Key}`
}

function extractDiagramType(mermaidSyntax: string): string {
  const firstLine = mermaidSyntax.trim().split('\n')[0].trim().toLowerCase()
  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) return 'flowchart'
  if (firstLine.startsWith('mindmap'))       return 'mindmap'
  if (firstLine.startsWith('sequencediagram')) return 'sequenceDiagram'
  if (firstLine.startsWith('statediagram'))  return 'stateDiagram'
  if (firstLine.startsWith('classdiagram'))  return 'classDiagram'
  if (firstLine.startsWith('pie'))           return 'pie'
  if (firstLine.startsWith('gantt'))         return 'gantt'
  if (firstLine.startsWith('erdiagram'))     return 'erDiagram'
  return firstLine.split(/\s/)[0] || 'unknown'
}

export default async function ArticleJobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = await params

  const job = await prisma.articleJob.findUnique({
    where: { id: jobId },
    include: {
      topic: true,
      user: { select: { id: true, email: true, name: true } },
      pipelineSteps: {
        orderBy: { stepNumber: 'asc' },
        include: {
          promptTemplate: { select: { stepName: true, defaultProvider: true, defaultModel: true } },
        },
      },
      sitePage: {
        include: {
          diagrams: { orderBy: { position: 'asc' } },
          sectionEnrichments: { orderBy: { position: 'asc' } },
        },
      },
      outputAttempts: { orderBy: { startedAt: 'desc' } },
      errorLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      llmUsage: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!job) notFound()

  const totalCost = job.llmUsage.reduce((s, r) => s + r.cost, 0)
  const isActive =
    ACTIVE_JOB_STATUSES.has(job.status) ||
    (job.sitePage?.enrichmentStatus === 'in_progress')

  const enrichmentCost =
    (job.sitePage?.diagrams?.reduce((s, d) => s + d.cost, 0) ?? 0) +
    (job.sitePage?.sectionEnrichments?.reduce((s, e) => s + e.cost, 0) ?? 0)

  return (
    <div className="space-y-6 max-w-4xl">
      <PollRefresh active={isActive} />

      <div className="flex items-center gap-3">
        <Link href="/admin/articles" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground truncate">
            {job.sitePage?.title ?? job.topic.topic}
          </h1>
          <p className="text-xs text-muted-foreground">
            {job.user.email} · Job {job.id} · ${totalCost.toFixed(4)}
          </p>
        </div>
        <StatusBadge status={job.status} enrichmentStatus={job.sitePage?.enrichmentStatus ?? null} />
        {job.status === 'needs_review' && <ReleaseButton jobId={job.id} />}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoCard label="Mode" value={job.topic.mode} />
        <InfoCard label="Step" value={`${job.currentStep} / ${TOTAL_PIPELINE_STEPS}`} />
        <InfoCard label="Total Cost" value={`$${totalCost.toFixed(4)}`} />
        <InfoCard label="Total Tokens" value={job.totalTokens.toLocaleString()} />
      </div>

      {job.sitePage && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-1.5">
          <h2 className="text-sm font-semibold text-foreground mb-3">SitePage</h2>
          <Row label="Title" value={job.sitePage.title} />
          <Row label="Slug" value={job.sitePage.slug} />
          <Row label="Primary Keyword" value={job.sitePage.primaryKeyword ?? '—'} />
          <Row label="SEO Title" value={job.sitePage.seoTitle ?? '—'} />
          <Row
            label="Enrichment"
            value={job.sitePage.enrichmentStatus}
            valueClass={
              job.sitePage.enrichmentStatus === 'completed'
                ? 'text-green-400'
                : job.sitePage.enrichmentStatus === 'failed'
                  ? 'text-red-400'
                  : undefined
            }
          />
          {enrichmentCost > 0 && (
            <Row label="Enrichment Cost" value={`$${enrichmentCost.toFixed(4)}`} />
          )}
        </div>
      )}

      {/* ── Pipeline Steps (Phase A + B) ─────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Pipeline Steps ({job.pipelineSteps.length})
        </h2>
        {job.pipelineSteps.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No steps yet</p>
        ) : (
          <div className="divide-y divide-border">
            {job.pipelineSteps.map((step) => (
              <div key={step.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-xs text-muted-foreground font-mono">{step.stepNumber}</span>
                    <span className="text-sm font-medium text-foreground">{step.stepName}</span>
                    <span className="text-xs text-muted-foreground">{step.provider}/{step.model}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">
                      {step.inputTokens}↑ {step.outputTokens}↓
                    </span>
                    <span className="font-mono text-foreground">${step.cost.toFixed(5)}</span>
                    <StepStatusBadge status={step.status} />
                  </div>
                </div>
                {step.output && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Output ({step.output.length.toLocaleString()} chars)
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted/30 p-2 text-xs text-foreground whitespace-pre-wrap break-words">
                      {step.output}
                    </pre>
                  </details>
                )}
                {step.errorMessage && (
                  <p className="mt-1 text-xs text-red-400 font-mono">{step.errorMessage}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── GEO Section Enrichments (Phase C — questions + summaries) ──────── */}
      {(job.sitePage?.sectionEnrichments?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
            GEO Section Enrichments ({job.sitePage!.sectionEnrichments.length})
          </h2>
          <div className="divide-y divide-border">
            {job.sitePage!.sectionEnrichments.map((enr) => (
              <div key={enr.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="w-6 shrink-0 text-xs text-muted-foreground font-mono mt-0.5">{enr.position}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">{enr.originalH2}</p>
                      {enr.question && (
                        <p className="text-sm font-medium text-foreground mt-0.5">{enr.question}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    {enr.questionSource && (
                      <span className={`rounded-full px-2 py-0.5 font-medium ${
                        enr.questionSource === 'faq_match'
                          ? 'bg-green-500/20 text-green-400'
                          : enr.questionSource === 'keyword_gen'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {enr.questionSource}
                      </span>
                    )}
                    <span className="text-muted-foreground">{enr.inputTokens}↑ {enr.outputTokens}↓</span>
                    <span className="font-mono text-foreground">${enr.cost.toFixed(5)}</span>
                  </div>
                </div>
                {enr.llmProvider && (
                  <p className="text-xs text-muted-foreground pl-8 mb-1">{enr.llmProvider}/{enr.llmModel}</p>
                )}
                {enr.summary && (
                  <details className="mt-1 pl-8">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Summary ({enr.summary.length.toLocaleString()} chars)
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/30 p-2 text-xs text-foreground whitespace-pre-wrap break-words">
                      {enr.summary}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Diagrams (Phase C — mermaid renders) ────────────────────────────── */}
      {(job.sitePage?.diagrams?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
            Diagrams ({job.sitePage!.diagrams.length})
          </h2>
          <div className="divide-y divide-border">
            {job.sitePage!.diagrams.map((diag) => {
              const svgLink  = cdnUrl(diag.svgS3Key)
              const pngLink  = cdnUrl(diag.pngS3Key)
              const darkLink = cdnUrl(diag.pngDarkS3Key)
              const diagramType = extractDiagramType(diag.mermaidSyntax)
              return (
                <div key={diag.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-xs text-muted-foreground font-mono">{diag.position}</span>
                      <span className="text-sm font-medium text-foreground truncate">{diag.sectionTitle}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">{diagramType}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="text-muted-foreground">{diag.inputTokens}↑ {diag.outputTokens}↓</span>
                      <span className="font-mono text-foreground">${diag.cost.toFixed(5)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground pl-8 mb-1">{diag.llmProvider}/{diag.llmModel}</p>
                  <div className="flex items-center gap-3 pl-8 mb-1">
                    {svgLink && (
                      <a href={svgLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">SVG →</a>
                    )}
                    {pngLink && (
                      <a href={pngLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">PNG →</a>
                    )}
                    {darkLink && (
                      <a href={darkLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">PNG dark →</a>
                    )}
                    {diag.pngWidth && diag.pngHeight && (
                      <span className="text-xs text-muted-foreground">{diag.pngWidth}×{diag.pngHeight}</span>
                    )}
                  </div>
                  <details className="mt-1 pl-8">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Mermaid syntax ({diag.mermaidSyntax.length.toLocaleString()} chars)
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/30 p-2 text-xs text-foreground whitespace-pre-wrap break-words">
                      {diag.mermaidSyntax}
                    </pre>
                  </details>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {job.errorLogs.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-card overflow-hidden">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-red-400">
            Error Logs ({job.errorLogs.length})
          </h2>
          <div className="divide-y divide-border">
            {job.errorLogs.map((err) => (
              <div key={err.id} className="px-4 py-3">
                <p className="text-xs font-medium text-red-400">{err.errorType}</p>
                <p className="mt-0.5 text-sm text-foreground">{err.errorMessage}</p>
                {err.stackTrace && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer">Stack trace</summary>
                    <pre className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground font-mono">
                      {err.stackTrace}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {job.outputAttempts.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Output Attempts</h2>
          <div className="divide-y divide-border">
            {job.outputAttempts.map((att) => (
              <div key={att.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <span className="font-medium text-foreground">{att.target}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Date(att.startedAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {att.durationMs && (
                    <span className="text-xs text-muted-foreground">{att.durationMs}ms</span>
                  )}
                  {att.resultUrl && (
                    <a
                      href={att.resultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      View →
                    </a>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      att.status === 'success'
                        ? 'bg-green-500/20 text-green-400'
                        : att.status === 'failed'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {att.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({
  status,
  enrichmentStatus,
}: {
  status: string
  enrichmentStatus?: string | null
}) {
  let label: string
  let cls: string

  if (status === 'in_progress' || status === 'pending') {
    label = 'Writing Article…'
    cls = 'bg-blue-500/20 text-blue-400'
  } else if (
    (status === 'completed' || status === 'approved') &&
    enrichmentStatus === 'in_progress'
  ) {
    label = 'Enrichment Processing…'
    cls = 'bg-blue-500/20 text-blue-400'
  } else if (status === 'completed') {
    label = 'Initial Written'
    cls = 'bg-yellow-500/20 text-yellow-400'
  } else if (status === 'approved' && enrichmentStatus !== 'completed') {
    label = 'Approved'
    cls = 'bg-emerald-500/20 text-emerald-400'
  } else if (status === 'enriched' || (status === 'approved' && enrichmentStatus === 'completed')) {
    label = 'Awaiting Review'
    cls = 'bg-purple-500/20 text-purple-400'
  } else if (status === 'published') {
    label = 'Published'
    cls = 'bg-green-500/20 text-green-400'
  } else if (status === 'failed') {
    label = 'Failed'
    cls = 'bg-red-500/20 text-red-400'
  } else {
    label = status
    cls = 'bg-muted text-muted-foreground'
  }

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function StepStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'text-muted-foreground',
    running: 'text-blue-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
  }
  return <span className={`font-medium ${colors[status] ?? 'text-muted-foreground'}`}>{status}</span>
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className={`break-all ${valueClass ?? 'text-foreground'}`}>{value}</span>
    </div>
  )
}
