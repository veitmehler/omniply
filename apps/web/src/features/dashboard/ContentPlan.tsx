'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  Loader2, CalendarRange, CalendarCheck, CalendarClock, Table as TableIcon, LayoutGrid, Pencil, X,
  Lightbulb, Plus, CalendarX, Mail, FileText, CheckCircle2, AlertTriangle, BookMarked,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ReviewApproveModal, type ReviewItem } from './ReviewApproveModal'
import { isEmbedMode } from '@/lib/embedSession'
import { TopicEditModal, type EditableTopic } from './TopicEditModal'
import { SocialReviewModal } from './SocialReviewModal'
import { SyndicationModal } from './SyndicationModal'
import { NewsletterReviewModal } from './NewsletterReviewModal'

interface ArticleEntry {
  source: 'scheduled' | 'article_calendar'
  topic: string
  topicId?: string
  calendarTopicId?: string
  status?: string
  jobId?: string
  jobStatus?: string
}
interface Day {
  date: string
  article: { primary: ArticleEntry | null; alternatives: ArticleEntry[] }
  newsletter: { topic: string; newsletterTopicId: string; newsletterId?: string; status?: string; isOverride: boolean } | null
}
interface PlanData { from: string; to: string; vertical?: string; days: Day[]; ideaCount: number; executableUntil: string | null }
interface Idea {
  id: string; topic: string; mode?: string | null
  outlineFrameworkNumber?: number | null; outlineSpecialInstructions?: string | null; realCaseStudies?: string | null
}
interface Inbox {
  articles: { jobId: string; title: string; finalQuality?: { verdict: string; reasons: string[] } | null }[]
  newsletters: { newsletterId: string; title: string }[]
  flagged: { jobId: string; title: string; reasons: string[] }[]
  assignedToMe?: { jobId: string; title: string }[]
  socialReady?: { articleJobIds: string[]; newsletterIds: string[] }
  socialGenerating?: { articleJobIds: string[]; newsletterIds: string[] }
}

// Cadence: articles Tue/Thu, newsletters Mon/Wed/Fri/Sat, Sunday nothing.
// Chiro product rhythm: articles Tue/Thu, newsletters Mon/Wed/Fri/Sat.
// Verticals can carry their own rhythm (azavea: articles Mon/Wed/Fri, no
// newsletter yet) — the plan response's `vertical` selects the set.
const DOW_BY_VERTICAL: Record<string, { article: Set<number>; newsletter: Set<number> }> = {
  chiro: { article: new Set([2, 4]), newsletter: new Set([1, 3, 5, 6]) },
  azavea: { article: new Set([1, 3, 5]), newsletter: new Set<number>() },
}
const dow = (date: string) => new Date(date + 'T00:00:00').getDay()

export function ContentPlan() {
  const [data, setData] = useState<PlanData | null>(null)
  const [inbox, setInbox] = useState<Inbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'table' | 'grid'>('table')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const [pickerTarget, setPickerTarget] = useState<{ date: string; kind: 'article' | 'newsletter' } | null>(null)
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [addDate, setAddDate] = useState<string | null>(null)
  const [addText, setAddText] = useState('')
  const [editTopic, setEditTopic] = useState<EditableTopic | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [socialReviewArticle, setSocialReviewArticle] = useState<{ jobId: string; title: string } | null>(null)
  const [socialReviewNewsletter, setSocialReviewNewsletter] = useState<{ newsletterId: string; title: string } | null>(null)
  const [syndicationFor, setSyndicationFor] = useState<{ jobId: string; title: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [planRes, inboxRes] = await Promise.all([
        fetch('/api/content-plan', { cache: 'no-store' }),
        fetch('/api/review-inbox', { cache: 'no-store' }),
      ])
      if (planRes.ok) setData(await planRes.json())
      if (inboxRes.ok) setInbox(await inboxRes.json())
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Sibling surfaces (the embed's EditRequestPickup) signal here when their
  // modal closes, so badges/buttons update without a page reload.
  useEffect(() => {
    const onRefresh = () => void load()
    window.addEventListener('omniply:refresh-inbox', onRefresh)
    return () => window.removeEventListener('omniply:refresh-inbox', onRefresh)
  }, [load])

  async function loadIdeas() {
    const res = await fetch('/api/topics/ideas', { cache: 'no-store' })
    if (res.ok) setIdeas((await res.json()).ideas ?? [])
  }

  const readyArticleIds = new Set((inbox?.articles ?? []).map((a) => a.jobId))
  const readyNewsletterIds = new Set((inbox?.newsletters ?? []).map((n) => n.newsletterId))
  const assignedToMeIds = new Set((inbox?.assignedToMe ?? []).map((a) => a.jobId))
  const socialReadyArticleIds = new Set(inbox?.socialReady?.articleJobIds ?? [])
  const socialReadyNewsletterIds = new Set(inbox?.socialReady?.newsletterIds ?? [])
  const socialGenArticleIds = new Set(inbox?.socialGenerating?.articleJobIds ?? [])
  const socialGenNewsletterIds = new Set(inbox?.socialGenerating?.newsletterIds ?? [])
  const anySocialGenerating = socialGenArticleIds.size > 0 || socialGenNewsletterIds.size > 0

  // While any social set is generating (~15min for an article), poll so the
  // "generating…" chip flips to the Review button without a manual reload.
  useEffect(() => {
    if (!anySocialGenerating) return
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anySocialGenerating])
  const readyQueue: ReviewItem[] = [
    ...(inbox?.articles ?? []).map((a) => ({ kind: 'article' as const, id: a.jobId, title: a.title, finalQuality: a.finalQuality ?? null })),
    ...(inbox?.newsletters ?? []).map((n) => ({ kind: 'newsletter' as const, id: n.newsletterId, title: n.title })),
  ]
  const queueIndexFor = (kind: 'article' | 'newsletter', id: string) => readyQueue.findIndex((q) => q.kind === kind && q.id === id)

  const visibleArticleIds = new Set((data?.days ?? []).map((d) => d.article.primary?.jobId).filter(Boolean) as string[])

  function onApproved() {
    setOpenIndex((idx) => (idx == null ? null : idx + 1 < readyQueue.length ? idx + 1 : null))
    void load()
  }

  async function planTopic(date: string, topic: string, source: 'manual' | 'article_calendar') {
    setBusyDate(date)
    try {
      const res = await fetch('/api/topics/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, scheduledDate: `${date}T00:00:00.000Z`, source }),
      })
      if (!res.ok) return toast.error('Failed to schedule')
      await load()
    } finally { setBusyDate(null) }
  }
  async function assignIdea(date: string, kind: 'article' | 'newsletter', idea: Idea) {
    setBusyDate(date)
    try {
      const res = kind === 'article'
        ? await fetch(`/api/topics/${idea.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledDate: `${date}T00:00:00.000Z` }),
          })
        : await fetch('/api/content-plan/newsletter-topic', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, ideaTopicId: idea.id }),
          })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return toast.error(body.error ?? 'Failed to assign idea')
      }
      setPickerTarget(null); await load()
    } finally { setBusyDate(null) }
  }
  async function unschedule(topicId: string, date: string) {
    setBusyDate(date)
    try {
      const res = await fetch(`/api/topics/${topicId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate: null }),
      })
      if (!res.ok) return toast.error('Failed to unschedule')
      await load()
    } finally { setBusyDate(null) }
  }
  async function revertNewsletterTopic(date: string) {
    setBusyDate(date)
    try {
      const res = await fetch(`/api/content-plan/newsletter-topic?date=${date}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return toast.error(body.error ?? 'Failed to revert')
      }
      await load()
    } finally { setBusyDate(null) }
  }
  async function generateSelected() {
    if (selected.size === 0) return
    setGenerating(true)
    try {
      const res = await fetch('/api/content-plan/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: Array.from(selected) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(body.error ?? 'Failed to start generation')
      toast.success(`Generating ${body.itemCount} item(s) — you'll get an email when they're ready to review.`)
      setSelected(new Set()); await load()
    } finally { setGenerating(false) }
  }

  // Only show content days (article = Tue/Thu, newsletter = Mon/Wed/Fri/Sat); skip Sundays.
  const rhythm = DOW_BY_VERTICAL[data?.vertical ?? 'chiro'] ?? DOW_BY_VERTICAL.chiro
  const visibleDays = (data?.days ?? []).filter((d) => rhythm.article.has(dow(d.date)) || rhythm.newsletter.has(dow(d.date)))
  // Planning window (up to 60 days) is always fully editable; production (checkbox-selectable)
  // is capped at executableUntil — the current paid cycle. Null means ungated (legacy accounts,
  // rendered as a single undivided section, exactly like before this feature existed).
  const executableUntil = data?.executableUntil ?? null
  const currentCycleDays = executableUntil ? visibleDays.filter((d) => d.date <= executableUntil) : visibleDays
  const nextCycleDays = executableUntil ? visibleDays.filter((d) => d.date > executableUntil) : []
  const selectableDates = currentCycleDays.filter((d) => d.article.primary || d.newsletter).map((d) => d.date)
  const toggleSelect = (date: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(date)) n.delete(date); else n.add(date); return n })
  const fmt = (date: string) => format(new Date(date + 'T00:00:00'), 'EEE, MMM d')

  // Approval → social generation takes ~5-15 min; without this chip the
  // approval looked like a no-op (Veit 2026-09-18). Polls via the inbox.
  function SocialGeneratingChip() {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Social posts generating…
      </span>
    )
  }

  function ReviewBtn({ kind, id }: { kind: 'article' | 'newsletter'; id: string }) {
    const idx = queueIndexFor(kind, id)
    return (
      <button onClick={() => idx >= 0 && setOpenIndex(idx)}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
        <CheckCircle2 className="h-3.5 w-3.5" /> Review &amp; Approve
      </button>
    )
  }

  // Distinct label from ReviewBtn (user request 2026-09-22): after the
  // article/newsletter itself is approved, the next step must READ as the
  // next step — "Approve social posts" — not repeat "Review & Approve".
  function SocialReviewBtn({ kind, id, title }: { kind: 'article' | 'newsletter'; id: string; title: string }) {
    return (
      <button
        onClick={() => kind === 'article'
          ? setSocialReviewArticle({ jobId: id, title })
          : setSocialReviewNewsletter({ newsletterId: id, title })}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
        <CheckCircle2 className="h-3.5 w-3.5" /> Approve social posts
      </button>
    )
  }

  // Materialize a calendar suggestion into a real topic, then open the options editor.
  async function materializeAndEdit(d: Day) {
    const p = d.article.primary
    if (p?.topicId) { setEditTopic({ id: p.topicId, topic: p.topic }); return }
    if (!p?.calendarTopicId) return
    setBusyDate(d.date)
    try {
      const res = await fetch('/api/topics/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: p.topic, scheduledDate: `${d.date}T00:00:00.000Z`, source: 'article_calendar' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error('Failed to open editor')
      await load()
      if (body.topic?.id) setEditTopic({ id: body.topic.id, topic: p.topic })
    } finally { setBusyDate(null) }
  }

  // The right-hand "Review" column for a day: assigned-edit > review > flagged,
  // plus (independently) social-post review once generation completes.
  function ReviewActions({ d }: { d: Day }) {
    const a = d.article.primary
    const nl = d.newsletter
    const assignedToMe = a?.jobId && assignedToMeIds.has(a.jobId)
    const articleReady = a?.jobId && readyArticleIds.has(a.jobId)
    const articleFlagged = a?.jobStatus === 'needs_review' && a.jobId
    // Published articles: the LinkedIn & Medium platform-article window
    // (syndication auto-generates at publish; this is the client's access).
    const articlePublished = a?.jobId && a.jobStatus === 'published'
    const nlReady = nl?.newsletterId && readyNewsletterIds.has(nl.newsletterId)
    const articleSocialReady = a?.jobId && socialReadyArticleIds.has(a.jobId)
    const nlSocialReady = nl?.newsletterId && socialReadyNewsletterIds.has(nl.newsletterId)
    const articleSocialGen = a?.jobId && socialGenArticleIds.has(a.jobId)
    const nlSocialGen = nl?.newsletterId && socialGenNewsletterIds.has(nl.newsletterId)
    if (!assignedToMe && !articleReady && !articleFlagged && !nlReady && !articleSocialReady && !nlSocialReady) {
      return <span className="text-xs text-muted-foreground">—</span>
    }
    return (
      <div className="flex flex-col items-end gap-1">
        {assignedToMe ? (
          // In the GHL embed, /review is a Clerk web page the iframe must
          // never navigate to — the EditRequestPickup banner above the plan
          // is the embed's pickup surface for the same requests.
          isEmbedMode() ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Pencil className="h-3.5 w-3.5" /> Edit requested — see banner above
            </span>
          ) : (
            <Link href={`/review/${a!.jobId}`} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              <Pencil className="h-3.5 w-3.5" /> Edit requested
            </Link>
          )
        ) : articleReady ? (
          <ReviewBtn kind="article" id={a!.jobId!} />
        ) : articleFlagged ? (
          isEmbedMode() ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Being reviewed
            </span>
          ) : (
            <Link href={`/workflow/${a!.jobId}/preview`} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline">
              <AlertTriangle className="h-3.5 w-3.5" /> Needs review
            </Link>
          )
        ) : null}
        {articleSocialReady && <SocialReviewBtn kind="article" id={a!.jobId!} title={a!.topic} />}
        {articleSocialGen && <SocialGeneratingChip />}
        {articlePublished && (
          <button
            onClick={() => setSyndicationFor({ jobId: a!.jobId!, title: a!.topic })}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            <BookMarked className="h-3.5 w-3.5" /> LinkedIn &amp; Medium
          </button>
        )}
        {nlReady && <ReviewBtn kind="newsletter" id={nl!.newsletterId!} />}
        {nlSocialReady && <SocialReviewBtn kind="newsletter" id={nl!.newsletterId!} title={nl!.topic} />}
        {nlSocialGen && <SocialGeneratingChip />}
      </div>
    )
  }

  function ArticleCell({ d }: { d: Day }) {
    if (!rhythm.article.has(dow(d.date))) return <span className="text-xs text-muted-foreground">—</span>
    const p = d.article.primary
    // Once generation has started, it's read-only here (review happens at right).
    if (p?.jobId) {
      return (
        <div>
          <div className="text-sm text-foreground">{p.topic}</div>
          {p.jobStatus && <span className="mt-0.5 inline-block rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{p.jobStatus}</span>}
        </div>
      )
    }
    // Replaceable: empty, a calendar suggestion, or a planned topic (no job yet).
    const replaceBtns = (
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => { setPickerTarget({ date: d.date, kind: 'article' }); loadIdeas() }} className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs hover:bg-muted">
          <Lightbulb className="h-3.5 w-3.5" /> Use idea
        </button>
        <button onClick={() => { setAddDate(d.date); setAddText('') }} className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs hover:bg-muted">
          <Plus className="h-3.5 w-3.5" /> Add topic
        </button>
        {p && (
          <button onClick={() => materializeAndEdit(d)} disabled={busyDate === d.date} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
            <Pencil className="h-3.5 w-3.5" /> Edit options
          </button>
        )}
        {p?.topicId && (
          <button onClick={() => unschedule(p.topicId!, d.date)} disabled={busyDate === d.date} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600" title="Clear (back to idea bank)"><CalendarX className="h-3.5 w-3.5" /></button>
        )}
      </div>
    )
    if (!p) return <div className="text-muted-foreground">{replaceBtns}</div>
    return (
      <div className="space-y-1">
        <div className="text-sm text-foreground">{p.topic}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {p.source === 'article_calendar'
            ? <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700">suggested</span>
            : <span className="rounded-full bg-muted px-1.5 py-0.5">scheduled</span>}
        </div>
        {replaceBtns}
      </div>
    )
  }

  function NewsletterCell({ d }: { d: Day }) {
    if (!rhythm.newsletter.has(dow(d.date))) return <span className="text-xs text-muted-foreground">—</span>
    const nl = d.newsletter
    // Once generation has started, it's read-only here (review happens at right) —
    // same convention as ArticleCell going read-only once a jobId exists.
    if (nl?.newsletterId) {
      return (
        <div>
          <div className="text-sm text-foreground">{nl.topic}</div>
          {nl.status && <span className="mt-0.5 inline-block rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{nl.status}</span>}
        </div>
      )
    }
    const useIdeaBtn = (
      <button onClick={() => { setPickerTarget({ date: d.date, kind: 'newsletter' }); loadIdeas() }} className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs hover:bg-muted">
        <Lightbulb className="h-3.5 w-3.5" /> Use idea
      </button>
    )
    if (!nl) return <div className="text-muted-foreground">{useIdeaBtn}</div>
    return (
      <div className="space-y-1">
        <div className="text-sm text-foreground">{nl.topic}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {nl.isOverride && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-700">your idea</span>
          )}
          {useIdeaBtn}
          {nl.isOverride && (
            <button onClick={() => revertNewsletterTopic(d.date)} disabled={busyDate === d.date} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600" title="Revert to original topic"><CalendarX className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
    )
  }

  function SectionHeader({ icon: Icon, title, description }: { icon: typeof CalendarCheck; title: string; description: string }) {
    return (
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    )
  }

  // Table/grid rendering shared by both cycle sections. `withCheckbox` is false
  // for the plan-ahead section — those days aren't in the production window yet,
  // so there's nothing to select there (still fully editable via the cells below).
  function PlanSection({ days, withCheckbox }: { days: Day[]; withCheckbox: boolean }) {
    if (view === 'table') {
      return (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                {withCheckbox && (
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" checked={selected.size > 0 && selected.size === selectableDates.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(selectableDates) : new Set())} className="h-4 w-4 rounded border-input" />
                  </th>
                )}
                <th className="w-32 px-3 py-2">Date</th>
                <th className="px-3 py-2"><span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Article</span></th>
                <th className="px-3 py-2"><span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Newsletter</span></th>
                <th className="w-44 px-3 py-2 text-right">Review</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const selectable = withCheckbox && !!(d.article.primary || d.newsletter)
                return (
                  <tr key={d.date} className="border-t border-border align-middle">
                    {withCheckbox && (
                      <td className="px-3 py-2.5">{selectable && <input type="checkbox" checked={selected.has(d.date)} onChange={() => toggleSelect(d.date)} className="h-4 w-4 rounded border-input" />}</td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">{fmt(d.date)}</td>
                    <td className="px-3 py-2.5"><ArticleCell d={d} /></td>
                    <td className="px-3 py-2.5"><NewsletterCell d={d} /></td>
                    <td className="px-3 py-2.5"><ReviewActions d={d} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((d) => (
          <div key={d.date} className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{fmt(d.date)}</span>
              {withCheckbox && (d.article.primary || d.newsletter) && <input type="checkbox" checked={selected.has(d.date)} onChange={() => toggleSelect(d.date)} className="h-4 w-4 rounded border-input" />}
            </div>
            <div className="space-y-2">
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"><FileText className="h-3 w-3" /> Article</div>
                <ArticleCell d={d} />
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"><Mail className="h-3 w-3" /> Newsletter</div>
                <NewsletterCell d={d} />
              </div>
              <div className="flex justify-end"><ReviewActions d={d} /></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Content Plan</h2>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {executableUntil
              ? 'This cycle is ready to produce; next cycle is open for planning.'
              : 'Your articles and newsletters for the next 30 days.'}
            {data ? ` ${data.ideaCount} ideas in your bank.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button onClick={() => setView('table')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${view === 'table' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}><TableIcon className="h-4 w-4" /> Table</button>
          <button onClick={() => setView('grid')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${view === 'grid' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}><LayoutGrid className="h-4 w-4" /> Grid</button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <span>{selected.size} day(s) selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="text-muted-foreground hover:text-foreground">Clear</button>
            <Button size="sm" onClick={generateSelected} disabled={generating}>
              {generating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Generate selected
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading plan…</div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Could not load your plan.</p>
      ) : executableUntil ? (
        <div className="space-y-6">
          <div>
            <SectionHeader icon={CalendarCheck} title="This Cycle — Ready to Produce"
              description={`${fmt(data.from)} – ${fmt(executableUntil)} · select days below to generate`} />
            <PlanSection days={currentCycleDays} withCheckbox />
          </div>
          {nextCycleDays.length > 0 && (
            <div>
              <SectionHeader icon={CalendarClock} title="Next Cycle — Plan Ahead"
                description={`${fmt(nextCycleDays[0].date)} – ${fmt(data.to)} · edit topics now, generation unlocks ${fmt(executableUntil)}`} />
              <PlanSection days={nextCycleDays} withCheckbox={false} />
            </div>
          )}
        </div>
      ) : (
        <PlanSection days={visibleDays} withCheckbox />
      )}

      {(inbox?.assignedToMe ?? []).filter((a) => !visibleArticleIds.has(a.jobId)).length > 0 && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Edits requested for you</div>
          <div className="space-y-2">
            {(inbox?.assignedToMe ?? []).filter((a) => !visibleArticleIds.has(a.jobId)).map((a) => (
              <div key={a.jobId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{a.title}</span>
                {isEmbedMode() ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <Pencil className="h-3.5 w-3.5" /> See banner above
                  </span>
                ) : (
                  <Link href={`/review/${a.jobId}`} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(inbox?.flagged?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Flagged by quality check</div>
          <div className="space-y-2">
            {inbox!.flagged.map((f) => (
              <div key={f.jobId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{f.title}</span>
                {!isEmbedMode() && (
                  <Link href={`/workflow/${f.jobId}/preview`} className="text-xs font-medium text-amber-800 hover:underline">Review →</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {openIndex != null && readyQueue[openIndex] && readyQueue[openIndex].kind === 'article' && (
        <ReviewApproveModal item={readyQueue[openIndex]} hasNext={openIndex < readyQueue.length - 1} onClose={() => { setOpenIndex(null); void load() }} onApproved={onApproved} />
      )}

      {/* Newsletters open the FULL review experience (edit sections, toggles,
          video controls, approve) — the generic scroll-gate modal hid all of
          it (run-5 report: "it's not showing up"). */}
      {openIndex != null && readyQueue[openIndex] && readyQueue[openIndex].kind === 'newsletter' && (
        <NewsletterReviewModal
          newsletterId={readyQueue[openIndex].id}
          title={readyQueue[openIndex].title}
          onClose={() => { setOpenIndex(null); void load() }}
        />
      )}

      {editTopic && (
        <TopicEditModal topic={editTopic} onClose={() => setEditTopic(null)} onSaved={() => { setEditTopic(null); void load() }} />
      )}

      {socialReviewArticle && (
        <SocialReviewModal
          jobId={socialReviewArticle.jobId}
          title={socialReviewArticle.title}
          onClose={() => { setSocialReviewArticle(null); void load() }}
          onApproved={() => { setSocialReviewArticle(null); void load() }}
        />
      )}

      {syndicationFor && (
        <SyndicationModal
          jobId={syndicationFor.jobId}
          articleTitle={syndicationFor.title}
          onClose={() => setSyndicationFor(null)}
        />
      )}

      {socialReviewNewsletter && (
        <NewsletterReviewModal
          newsletterId={socialReviewNewsletter.newsletterId}
          title={socialReviewNewsletter.title}
          onClose={() => { setSocialReviewNewsletter(null); void load() }}
          onApproved={() => { setSocialReviewNewsletter(null); void load() }}
        />
      )}

      {pickerTarget && (
        <Modal title={`Use an idea for ${fmt(pickerTarget.date)}`} onClose={() => setPickerTarget(null)}>
          {ideas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ideas in your bank yet. Capture some above.</p>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {ideas.map((idea) => (
                <button key={idea.id} onClick={() => assignIdea(pickerTarget.date, pickerTarget.kind, idea)} disabled={busyDate === pickerTarget.date}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
                  <span className="min-w-0 flex-1 truncate">{idea.topic}</span>
                  <span className="text-xs text-primary">Schedule →</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {addDate && (
        <Modal title={`Add an article topic for ${fmt(addDate)}`} onClose={() => setAddDate(null)}>
          <div className="flex flex-col gap-3">
            <input value={addText} onChange={(e) => setAddText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && addText.trim()) { planTopic(addDate, addText.trim(), 'manual'); setAddDate(null) } }}
              autoFocus placeholder="Article topic / working title" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDate(null)}>Cancel</Button>
              <Button onClick={() => { planTopic(addDate, addText.trim(), 'manual'); setAddDate(null) }} disabled={!addText.trim()}>Add to plan</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
