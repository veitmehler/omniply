'use client'

/**
 * Chat-styled onboarding UI (onboarding plan Phase 1).
 *
 * Renders the scripted flow as a conversation: assistant bubbles from the
 * step's messages, the user's committed answers as their bubbles, and one
 * input affordance matching the current step kind. Voice recording, rich
 * confirm-cards and background-job awareness arrive with Phases 2–3; this
 * shell already resumes mid-flow (server-held state) and supports text,
 * choice and basic card-confirm answers.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { embedFetch } from '@/lib/embedSession'
import { VoiceRecorder } from './VoiceRecorder'
import { BusinessCard, LogoCard, PhotoCard, ProfileCard, TemplateCard, OffersCard, WordpressCard, SocialsCard, FrontDeskCard, KbReviewCard } from './cards'
import { currentEmbedSession, embedApiUrl } from '@/lib/embedSession'

// The chat message scrolls away — the input itself must say what belongs in it.
const TEXT_PLACEHOLDERS: Record<string, string> = {
  writing_sample: 'Paste a blog post, patient email, or any writing of yours (500+ words) — or type "skip"…',
  booking_url: 'Paste the link patients use to book online, e.g. https://your-practice.com/book…',
  gbp: 'Paste your Google Business Profile (Maps) link — or type "skip"…',
}

interface StepView {
  id: string
  kind: 'info' | 'text' | 'choice' | 'confirm_card' | 'voice' | 'action'
  messages: string[]
  options?: { value: string; label: string }[]
  card?: Record<string, unknown>
  progress: { index: number; total: number }
  pending?: boolean
}

interface HistoryEntry {
  step: string
  answer: unknown
  at: string
}

interface ChatBubble {
  role: 'assistant' | 'user'
  text: string
}

function answerToText(answer: unknown): string {
  if (typeof answer === 'string') return answer
  if (answer && typeof answer === 'object') {
    const a = answer as Record<string, unknown>
    if (typeof a.label === 'string') return a.label
    if (typeof a.text === 'string') return a.text
    if (a.confirmed === true) return 'Looks good ✓'
  }
  return '✓'
}

export function OnboardingChat({ onCompleted }: { onCompleted: () => void }) {
  const [step, setStep] = useState<StepView | null>(null)
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await embedFetch('/api/onboarding/state')
    const data = await res.json()
    if (data.completed) return onCompleted()
    const history: HistoryEntry[] = data.history ?? []
    // Rebuild transcript: we only have answers historically; step messages are
    // re-shown for the CURRENT step. Keep it simple: prior answers as user
    // bubbles with a light assistant separator.
    const rebuilt: ChatBubble[] = history.flatMap((h) => [{ role: 'user' as const, text: answerToText(h.answer) }])
    setBubbles([...rebuilt, ...data.step.messages.map((m: string) => ({ role: 'assistant' as const, text: m }))])
    setStep(data.step)
  }, [onCompleted])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bubbles])

  async function submit(answer: unknown, display?: string) {
    if (!step || busy) return
    setBusy(true)
    setBubbles((b) => [...b, { role: 'user', text: display ?? answerToText(answer) }])
    try {
      const res = await embedFetch('/api/onboarding/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: step.id, answer }),
      })
      const data = await res.json()
      const next: StepView = res.status === 409 ? data.step : data.step
      if (next) {
        setBubbles((b) => [...b, ...next.messages.map((m: string) => ({ role: 'assistant' as const, text: m }))])
        setStep(next)
      }
    } finally {
      setBusy(false)
      setInput('')
    }
  }

  async function complete() {
    setBusy(true)
    try {
      const res = await embedFetch('/api/onboarding/complete', { method: 'POST' })
      if (res.ok) return onCompleted()
      const data = await res.json()
      const missing = (data.readiness?.missing ?? []) as { field: string; why: string }[]
      setBubbles((b) => [
        ...b,
        {
          role: 'assistant',
          text: missing.length
            ? `Almost — a few things still need attention: ${missing.map((m) => m.field).join(', ')}`
            : (data.error ?? 'Not quite ready yet.'),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  if (!step) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-screen max-w-4xl flex-col">
      {/* progress */}
      <div className="px-4 pt-4">
        <div className="h-1 w-full rounded bg-muted">
          <div
            className="h-1 rounded bg-primary transition-all"
            style={{ width: `${(step.progress.index / step.progress.total) * 100}%` }}
          />
        </div>
      </div>

      {/* transcript */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm md:text-base ${
                b.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm border border-border bg-card text-foreground'
              }`}
            >
              {b.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-2.5 text-sm md:text-base text-muted-foreground">
              <span className="animate-pulse">…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* input affordance per step kind */}
      <div className="border-t border-border p-4">
        {step.kind === 'info' && (
          <button
            onClick={() => submit({ acknowledged: true }, "Let's go!")}
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Let&apos;s go
          </button>
        )}

        {step.kind === 'voice' && (
          <div className="space-y-3">
            <VoiceRecorder
              step={step.id}
              disabled={busy}
              onConfirm={(answer) => void submit(answer, answer.text)}
            />
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Prefer to type?</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (input.trim()) void submit({ text: input.trim(), voice: false })
                }}
                className="mt-2 flex gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm md:text-base text-foreground"
                  disabled={busy}
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="self-end rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </details>
          </div>
        )}

        {step.kind === 'text' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (input.trim()) void submit({ text: input.trim() })
            }}
            className="flex gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={4}
              placeholder={TEXT_PLACEHOLDERS[step.id] ?? 'Paste here…'}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm md:text-base text-foreground"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="self-end rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Send
            </button>
          </form>
        )}

        {step.kind === 'choice' && (
          <ChoiceInput step={step} busy={busy} onSubmit={(answer, display) => void submit(answer, display)} />
        )}

        {step.kind === 'confirm_card' &&
          (step.pending ? (
            <PendingCard onRefresh={() => void load()} />
          ) : (
            <ConfirmCard step={step} busy={busy} onSubmit={(answer, display) => void submit(answer, display)} />
          ))}

        {step.kind === 'action' && (
          <button
            onClick={() => void complete()}
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            🚀 Start generating my first month
          </button>
        )}
      </div>
    </div>
  )
}

/** Background job still running: friendly wait state with a manual refresh. */
function PendingCard({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-center">
      <p className="text-sm text-muted-foreground">
        <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent align-middle" />
        Still working on this — usually under a minute…
      </p>
      <button onClick={onRefresh} className="text-xs text-primary underline">
        Check again
      </button>
    </div>
  )
}

/** Routes each confirm step to its dedicated card component. */
function ConfirmCard({
  step,
  busy,
  onSubmit,
}: {
  step: StepView
  busy: boolean
  onSubmit: (answer: unknown, display?: string) => void
}) {
  const card = (step.card ?? {}) as Record<string, unknown>
  switch (step.id) {
    case 'business_confirm':
      return <BusinessCard card={card} disabled={busy} onSubmit={(a) => onSubmit(a, "That's correct ✓")} />
    case 'logo_confirm':
      return (
        <LogoCard
          card={card as { candidates?: string[] }}
          disabled={busy}
          onSubmit={(a) => onSubmit(a, a.none ? 'No logo' : 'Use this logo ✓')}
        />
      )
    case 'photo':
      return (
        <PhotoCard
          disabled={busy}
          uploadUrl={embedApiUrl('/api/onboarding/photo')}
          authToken={`Bearer emb_${currentEmbedSession()?.token ?? ''}`}
          onSubmit={(a) => onSubmit(a, a.none ? 'Skip for now' : 'Use this photo ✓')}
        />
      )
    case 'brand_profile_confirm':
      return <ProfileCard card={card} disabled={busy} onSubmit={(a) => onSubmit(a, 'This is my brand ✓')} />
    case 'template_reveal':
      return (
        <TemplateCard
          card={card as { palette?: Record<string, unknown>; logoUrl?: string | null; organizationName?: string }}
          disabled={busy}
          onSubmit={(a) => onSubmit(a, "I love it — that's my newsletter ✓")}
        />
      )
    case 'offers':
      return <OffersCard card={card as { offers?: never[] }} disabled={busy} onSubmit={(a) => onSubmit(a, 'Offers saved ✓')} />
    case 'wordpress':
      return (
        <WordpressCard
          card={card as { website?: string }}
          disabled={busy}
          downloadUrl={embedApiUrl('/api/onboarding/linktree.html')}
          authToken={`Bearer emb_${currentEmbedSession()?.token ?? ''}`}
          onSubmit={(a) => onSubmit(a, a.mode === 'skip' ? 'No WordPress — HTML export' : 'Connect & verify ✓')}
        />
      )
    case 'socials':
      return <SocialsCard disabled={busy} onSubmit={(a) => onSubmit(a, "I've connected my accounts ✓")} />
    case 'front_desk':
      return <FrontDeskCard disabled={busy} onSubmit={onSubmit} />
    case 'kb_review':
      return <KbReviewCard card={card} disabled={busy} onSubmit={onSubmit} />
    default:
      return (
        <button
          onClick={() => onSubmit({ confirmed: true }, 'Looks good ✓')}
          disabled={busy}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Looks good
        </button>
      )
  }
}

/** Choice pills, with two special cases: custom CTA text and the ElevenLabs key. */
function ChoiceInput({
  step,
  busy,
  onSubmit,
}: {
  step: StepView
  busy: boolean
  onSubmit: (answer: unknown, display?: string) => void
}) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [text2, setText2] = useState('')

  if (revealed === 'pms_other') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onSubmit({ value: 'other', customText: text.trim() }, text.trim())
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's it called?"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={busy}
          autoFocus
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          Send
        </button>
      </form>
    )
  }

  if (revealed === 'cta_keyword') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onSubmit({ value: 'dm_keyword', customText: `${text.trim()}|${text2.trim()}` }, `Comment "${text.trim().toUpperCase()}" → free guide`)
        }}
        className="space-y-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\s+/g, ''))}
          placeholder='Comment keyword (one word, e.g. "SPINE")'
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={busy}
          autoFocus
        />
        <input
          value={text2}
          onChange={(e) => setText2(e.target.value)}
          placeholder='What we send them (e.g. "our 2-Minute Spine Check")'
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !text.trim()} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          Set keyword CTA
        </button>
      </form>
    )
  }

  if (revealed === 'custom') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onSubmit({ value: 'custom', customText: text.trim() }, text.trim())
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Where should posts send people?"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={busy}
          autoFocus
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          Set CTA
        </button>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(step.options ?? []).map((o) => (
        <button
          key={o.value}
          onClick={() => {
            if (step.id === 'cta' && o.value === 'custom') return setRevealed('custom')
            if (step.id === 'cta' && o.value === 'dm_keyword') return setRevealed('cta_keyword')
            if (step.id === 'pms' && o.value === 'other') return setRevealed('pms_other')
            if (step.id === 'google_reviews' && o.value === 'connect') {
              const startPath = (step.card as { startPath?: string } | undefined)?.startPath
              if (startPath) window.open(`${process.env.NEXT_PUBLIC_API_URL ?? ''}${startPath}`, '_blank', 'width=520,height=680')
            }
            onSubmit({ value: o.value, label: o.label }, o.label)
          }}
          disabled={busy}
          className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
