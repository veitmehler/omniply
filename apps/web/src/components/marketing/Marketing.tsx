/**
 * Shared marketing-site building blocks (marketing-site plan).
 *
 * Brand tokens = the real Omniply system (site refresh 2026-08-05): layered
 * near-black grounds and the electric lime #C3F43B, matching the X-Ray funnel
 * and the Debrief PDF. On light sections the accent uses darker lime-green
 * derivatives for contrast; pure lime lives on dark grounds and buttons.
 * Copy style is dash-free (house rule). All diagrams are inline SVG.
 */
import React from 'react'
import Link from 'next/link'

export const TOKENS = {
  ink: '#0A2A3F',
  inkDeep: '#052234',
  paper: '#F5F6F4',
  body: '#1A1A1C',
  muted: '#55555C',
  accent: '#84B420', // lime-green readable on light grounds (diagrams, links)
  accentDeep: '#5F8A14', // eyebrows / emphasis text on light grounds
  lime: '#C3F43B', // pure brand lime: dark grounds + button fills only
  line: '#E2E3E6',
}

export const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? '#pricing'
export const XRAY_URL = '/x-ray'

export function Cta({ children, sub, href }: { children: React.ReactNode; sub?: string; href?: string }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <a
        href={href ?? CHECKOUT_URL}
        className="inline-block rounded-xl px-10 py-5 text-lg font-bold shadow-lg transition-transform hover:scale-[1.02]"
        style={{ background: TOKENS.lime, color: '#0B0B0C' }}
      >
        {children}
      </a>
      {sub && <p className="text-sm opacity-80">{sub}</p>}
    </div>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  // color comes from the enclosing Section via --eyebrow (lime on dark, deep green on light)
  return (
    <div className="mb-3 text-[16px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--eyebrow)' }}>
      {children}
    </div>
  )
}

export function Section({
  children,
  dark,
  id,
}: {
  children: React.ReactNode
  dark?: boolean
  id?: string
}) {
  return (
    <section
      id={id}
      className="px-6 py-20 md:py-28"
      style={
        (dark
          ? { background: `linear-gradient(180deg, ${TOKENS.ink}, ${TOKENS.inkDeep})`, color: '#fff', ['--eyebrow' as string]: TOKENS.lime }
          : { background: TOKENS.paper, color: TOKENS.body, ['--eyebrow' as string]: TOKENS.accentDeep }) as React.CSSProperties
      }
    >
      <div className="mx-auto max-w-3xl">{children}</div>
    </section>
  )
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-6 text-3xl font-bold leading-tight md:text-4xl" style={{ textWrap: 'balance' } as React.CSSProperties}>{children}</h2>
}

export function P({ children, lead }: { children: React.ReactNode; lead?: boolean }) {
  return <p className={`mb-5 leading-relaxed ${lead ? 'text-[22px]' : 'text-[20px]'}`}>{children}</p>
}

export function Bullet({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <li className="mb-5 flex gap-4">
      <HexDot />
      <span className="text-[20px] leading-relaxed">
        <strong>{head}</strong> {children}
      </span>
    </li>
  )
}

function HexDot() {
  return (
    <svg width="22" height="24" viewBox="0 0 22 24" className="mt-1.5 flex-shrink-0">
      <path d="M11 1 20.5 6.5v11L11 23 1.5 17.5v-11Z" fill="none" stroke={TOKENS.accent} strokeWidth="2" />
      <circle cx="11" cy="12" r="3.5" fill={TOKENS.accent} />
    </svg>
  )
}

/* ── Diagram 1: sawtooth vs compounding consistency ─────────────────────── */
export function ConsistencyGraph({ onDark }: { onDark?: boolean }) {
  const axis = onDark ? '#343434' : TOKENS.line
  const dim = onDark ? 'rgba(255,255,255,0.6)' : TOKENS.muted
  const curve = onDark ? TOKENS.lime : TOKENS.accent
  const label = onDark ? TOKENS.lime : TOKENS.accentDeep
  return (
    <figure className="my-10">
      <svg viewBox="0 0 560 260" className="w-full">
        <line x1="40" y1="220" x2="540" y2="220" stroke={axis} strokeWidth="2" />
        <line x1="40" y1="220" x2="40" y2="20" stroke={axis} strokeWidth="2" />
        <text x="290" y="248" textAnchor="middle" fontSize="13" fill={dim}>Months of marketing</text>
        <text x="18" y="120" textAnchor="middle" fontSize="13" fill={dim} transform="rotate(-90 18 120)">Patient attention</text>
        {/* sawtooth: bursts that decay */}
        <path d="M40 218 L80 150 L120 210 L160 140 L200 205 L240 155 L280 212 L330 160 L380 214" fill="none" stroke={dim} strokeWidth="3" strokeDasharray="1 0" opacity="0.75" />
        <text x="385" y="228" fontSize="13" fill={dim} fontWeight="700">Bursts (most practices)</text>
        {/* compounding */}
        <path d="M40 218 C 200 210, 330 170, 420 100 C 470 62, 510 42, 540 30" fill="none" stroke={curve} strokeWidth="4" />
        <circle cx="540" cy="30" r="6" fill={curve} />
        <text x="440" y="60" fontSize="14" fill={label} fontWeight="700">Weekly, every week</text>
      </svg>
      <figcaption className="mt-2 text-center text-sm" style={{ color: dim }}>
        Attention compounds only when content ships every week. Bursts reset to zero.
      </figcaption>
    </figure>
  )
}

/* ── Diagram 2: agent variance vs deterministic pipeline ────────────────── */
export function VarianceDiagram() {
  const outs = [58, 88, 118, 148, 178]
  return (
    <figure className="my-10">
      <svg viewBox="0 0 560 240" className="w-full">
        {/* left: agent */}
        <rect x="20" y="95" width="120" height="46" rx="10" fill="none" stroke={TOKENS.muted} strokeWidth="2.5" />
        <text x="80" y="123" textAnchor="middle" fontSize="14" fill={TOKENS.muted} fontWeight="700">AI agent</text>
        {outs.map((y, i) => (
          <g key={i}>
            <path d={`M140 118 C 190 118, 190 ${y + 12} , 235 ${y + 12}`} fill="none" stroke={TOKENS.muted} strokeWidth="2" opacity="0.55" />
            <rect x="235" y={y} width="58" height="24" rx="6" fill="none" stroke={TOKENS.muted} strokeWidth="2" opacity="0.55" />
            <text x="264" y={y + 16} textAnchor="middle" fontSize="11" fill={TOKENS.muted}>run {i + 1}</text>
          </g>
        ))}
        <text x="160" y="215" fontSize="13" fill={TOKENS.muted} fontWeight="700">Different output every run</text>
        {/* right: pipeline */}
        <rect x="330" y="95" width="120" height="46" rx="10" fill="none" stroke={TOKENS.accent} strokeWidth="3" />
        <text x="390" y="123" textAnchor="middle" fontSize="14" fill={TOKENS.accentDeep} fontWeight="700">Omniply</text>
        <path d="M450 118 L505 118" stroke={TOKENS.accent} strokeWidth="3" />
        <rect x="505" y="103" width="46" height="30" rx="6" fill={TOKENS.accent} />
        <text x="528" y="122" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">✓</text>
        <text x="415" y="215" fontSize="13" fill={TOKENS.accentDeep} fontWeight="700">Same system, every time</text>
      </svg>
      <figcaption className="mt-2 text-center text-sm" style={{ color: TOKENS.muted }}>
        Agents improvise. A pipeline repeats what works, with a human approval gate built in.
      </figcaption>
    </figure>
  )
}

/* ── Diagram 3: one brand in → five channels out ────────────────────────── */
export function PipelineDiagram() {
  const channels = ['Articles', 'Newsletters', 'Social posts', 'Lead magnets', 'Review engine']
  return (
    <figure className="my-10">
      <svg viewBox="0 0 560 300" className="w-full">
        <rect x="20" y="120" width="110" height="56" rx="10" fill="none" stroke="#fff" strokeWidth="2.5" />
        <text x="75" y="144" textAnchor="middle" fontSize="13" fill="#fff" fontWeight="700">Your voice</text>
        <text x="75" y="162" textAnchor="middle" fontSize="13" fill="#fff" fontWeight="700">Your brand</text>
        <rect x="215" y="118" width="130" height="60" rx="12" fill={TOKENS.accent} />
        <text x="280" y="143" textAnchor="middle" fontSize="14" fill="#fff" fontWeight="800">Review gate</text>
        <text x="280" y="161" textAnchor="middle" fontSize="12" fill="#fff">you approve, once</text>
        <path d="M130 148 L215 148" stroke="#fff" strokeWidth="2.5" />
        {channels.map((c, i) => {
          const y = 34 + i * 54
          return (
            <g key={c}>
              <path d={`M345 148 C 400 148, 400 ${y + 15}, 430 ${y + 15}`} fill="none" stroke="#fff" strokeWidth="2" opacity="0.8" />
              <rect x="430" y={y} width="118" height="32" rx="8" fill="none" stroke="#fff" strokeWidth="2" />
              <text x="489" y={y + 21} textAnchor="middle" fontSize="12.5" fill="#fff" fontWeight="600">{c}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 text-center text-sm text-white/70">
        One system. Every channel your patients actually see. Published on schedule without you.
      </figcaption>
    </figure>
  )
}

/* ── Diagram 4: touchpoints → conversion ────────────────────────────────── */
export function TouchpointGraph() {
  const bars = [
    { label: '1 to 2', v: 40 },
    { label: '3 to 5', v: 78 },
    { label: '6 to 10', v: 120 },
    { label: '11+', v: 170 },
  ]
  return (
    <figure className="my-10">
      <svg viewBox="0 0 560 260" className="w-full">
        <line x1="60" y1="220" x2="540" y2="220" stroke={TOKENS.line} strokeWidth="2" />
        {bars.map((b, i) => {
          const x = 90 + i * 115
          return (
            <g key={b.label}>
              <rect x={x} y={220 - b.v} width="70" height={b.v} rx="6" fill={i === 3 ? TOKENS.accent : TOKENS.line} />
              <text x={x + 35} y="242" textAnchor="middle" fontSize="12.5" fill={TOKENS.muted}>{b.label}</text>
            </g>
          )
        })}
        <text x="300" y="258" textAnchor="middle" fontSize="13" fill={TOKENS.muted} fontWeight="700">Touchpoints before a prospect books</text>
        <text x="470" y="40" textAnchor="middle" fontSize="13" fill={TOKENS.accentDeep} fontWeight="700">This is where bookings live</text>
      </svg>
      <figcaption className="mt-2 text-center text-sm" style={{ color: TOKENS.muted }}>
        Most prospects need many touches before they book. Almost nobody sustains that manually.
      </figcaption>
    </figure>
  )
}

/* ── Diagram 5: reactivation loop ───────────────────────────────────────── */
export function ReactivationLoop() {
  return (
    <figure className="my-10">
      <svg viewBox="0 0 560 260" className="w-full">
        <circle cx="280" cy="130" r="95" fill="none" stroke={TOKENS.line} strokeWidth="2.5" strokeDasharray="6 7" />
        {[
          { x: 280, y: 22, t1: 'Patient visits', t2: '' },
          { x: 425, y: 130, t1: 'Life gets busy,', t2: 'they drift' },
          { x: 280, y: 238, t1: 'Your newsletter', t2: 'lands anyway' },
          { x: 135, y: 130, t1: 'They rebook', t2: '' },
        ].map((n, i) => (
          <g key={i}>
            <rect x={n.x - 62} y={n.y - 22} width="124" height="44" rx="10" fill={TOKENS.paper} stroke={i === 2 ? TOKENS.accent : TOKENS.muted} strokeWidth={i === 2 ? 3 : 2} />
            <text x={n.x} y={n.y - 2 + (n.t2 ? 0 : 6)} textAnchor="middle" fontSize="12.5" fill={i === 2 ? TOKENS.accentDeep : TOKENS.body} fontWeight="700">{n.t1}</text>
            {n.t2 && <text x={n.x} y={n.y + 14} textAnchor="middle" fontSize="12.5" fill={i === 2 ? TOKENS.accentDeep : TOKENS.body} fontWeight="700">{n.t2}</text>}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-center text-sm" style={{ color: TOKENS.muted }}>
        Reactivation is the cheapest revenue in your practice. It only works if the reminder actually goes out.
      </figcaption>
    </figure>
  )
}

/* ── Pricing block ──────────────────────────────────────────────────────── */
export function PricingBlock({ vertical }: { vertical?: boolean }) {
  return (
    <div id="pricing" className="my-8 rounded-2xl border-2 p-8 md:p-10" style={{ borderColor: TOKENS.accent, background: '#fff' }}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-5xl font-extrabold" style={{ color: TOKENS.ink }}>$397</span>
        <span className="text-xl" style={{ color: TOKENS.muted }}>per month. That is the whole number.</span>
      </div>
      <ul className="mt-6 space-y-2 text-lg">
        <li><strong>All content included.</strong> Articles, newsletters, social posts, lead magnets. No per-piece charges, ever.</li>
        <li><strong>25,000 emails per month included.</strong> Your patient list hears from you weekly and it costs you nothing extra.</li>
        <li><strong>No contracts.</strong> Cancel any month. Keep everything already published, because it is yours.</li>
      </ul>
      <div className="mt-8 rounded-xl p-6" style={{ background: TOKENS.paper }}>
        <p className="text-lg leading-relaxed">
          <strong>Now do the honest math on the alternative.</strong> A part-time content person costs $2,500 to
          $5,000 a month and still needs your input for every piece. Doing it yourself costs 15 or more hours a
          week of {vertical ? 'adjustment-room time' : 'your highest-value time'}, and it is always the first
          thing dropped when the week gets busy. Which is exactly when the compounding curve resets to zero.
        </p>
      </div>
    </div>
  )
}

/* ── FAQ ────────────────────────────────────────────────────────────────── */
export interface FaqEntry {
  q: string
  a: string
}

export function Faq({ items }: { items: FaqEntry[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details
          key={item.q}
          className="group rounded-xl border bg-white p-5"
          style={{ borderColor: TOKENS.line }}
        >
          <summary className="cursor-pointer list-none text-lg font-bold" style={{ color: TOKENS.ink }}>
            <span className="mr-2 inline-block transition-transform group-open:rotate-90" style={{ color: TOKENS.accent }}>
              ▸
            </span>
            {item.q}
          </summary>
          <p className="mt-3 text-lg leading-relaxed" style={{ color: TOKENS.body }}>
            {item.a}
          </p>
        </details>
      ))}
    </div>
  )
}

/** FAQPage JSON-LD for rich results. */
export function FaqJsonLd({ items }: { items: FaqEntry[] }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}

/* ── Diagram 6: the Google map pack ─────────────────────────────────────── */
export function MapPackDiagram({ query }: { query?: string }) {
  const q = query ?? 'chiropractor near me'
  return (
    <figure className="my-10">
      <svg viewBox="0 0 560 330" className="w-full">
        {/* search bar */}
        <rect x="60" y="14" width="440" height="44" rx="22" fill="#fff" stroke={TOKENS.line} strokeWidth="2" />
        <circle cx="92" cy="36" r="9" fill="none" stroke={TOKENS.muted} strokeWidth="2.5" />
        <line x1="98" y1="43" x2="106" y2="51" stroke={TOKENS.muted} strokeWidth="2.5" />
        <text x="122" y="42" fontSize="15" fill={TOKENS.body}>{q}</text>
        {/* map pack container */}
        <rect x="60" y="76" width="440" height="168" rx="12" fill="#fff" stroke={TOKENS.line} strokeWidth="2" />
        <text x="76" y="100" fontSize="11" fill={TOKENS.muted} fontWeight="700" letterSpacing="1">THE MAP PACK · ONLY 3 GET SHOWN</text>
        {/* result 1 — you */}
        <rect x="72" y="110" width="416" height="38" rx="8" fill="none" stroke={TOKENS.accent} strokeWidth="3" />
        <rect x="82" y="120" width="90" height="10" rx="5" fill={TOKENS.ink} />
        <text x="182" y="130" fontSize="13" fill={TOKENS.accentDeep}>★★★★★</text>
        <text x="248" y="130" fontSize="12" fill={TOKENS.accentDeep} fontWeight="700">214 reviews · newest this week</text>
        <text x="452" y="131" fontSize="11" fill="#fff" fontWeight="800" textAnchor="middle">YOU</text>
        <rect x="432" y="118" width="40" height="18" rx="9" fill={TOKENS.accent} />
        <text x="452" y="131" fontSize="11" fill="#fff" fontWeight="800" textAnchor="middle">YOU</text>
        {/* results 2-3 */}
        <rect x="72" y="154" width="416" height="36" rx="8" fill="none" stroke={TOKENS.line} strokeWidth="2" />
        <rect x="82" y="164" width="80" height="9" rx="4.5" fill={TOKENS.line} />
        <text x="182" y="174" fontSize="13" fill={TOKENS.muted}>★★★★☆</text>
        <text x="248" y="174" fontSize="12" fill={TOKENS.muted}>41 reviews · newest 2 years ago</text>
        <rect x="72" y="196" width="416" height="36" rx="8" fill="none" stroke={TOKENS.line} strokeWidth="2" />
        <rect x="82" y="206" width="96" height="9" rx="4.5" fill={TOKENS.line} />
        <text x="182" y="216" fontSize="13" fill={TOKENS.muted}>★★★★☆</text>
        <text x="248" y="216" fontSize="12" fill={TOKENS.muted}>28 reviews · newest last year</text>
        {/* below the fold */}
        <line x1="60" y1="262" x2="500" y2="262" stroke={TOKENS.line} strokeWidth="2" strokeDasharray="7 7" />
        <rect x="72" y="276" width="416" height="18" rx="6" fill={TOKENS.line} opacity="0.45" />
        <rect x="72" y="302" width="416" height="18" rx="6" fill={TOKENS.line} opacity="0.25" />
        <text x="280" y="259" textAnchor="middle" fontSize="11.5" fill={TOKENS.muted} fontWeight="700">EVERYONE ELSE · SCROLLED PAST</text>
      </svg>
      <figcaption className="mt-2 text-center text-sm" style={{ color: TOKENS.muted }}>
        Google fills these three spots largely on reviews: how many, how recent, how steady.
      </figcaption>
    </figure>
  )
}

/* ── The Omniply Loop flywheel (site adaptation of the Debrief diagram) ──── */
export function LoopDiagram() {
  const node = (x: number, y: number, w: number, label: string) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={40} rx={9} fill="#18181A" stroke="#343434" />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fill="#FFFFFF" fontSize="12.5" fontFamily="ui-monospace, Menlo, monospace" letterSpacing="2">
        {label}
      </text>
    </g>
  )
  return (
    <div className="my-10 flex justify-center overflow-x-auto">
      <svg width="380" height="380" viewBox="0 0 430 430" role="img" aria-label="The Omniply Loop: Presence, Proof, Recall, Response">
        <defs>
          <marker id="loop-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#C3F43B" />
          </marker>
        </defs>
        <g fill="none" stroke="#C3F43B" strokeWidth="2">
          <path d="M 262 78 A 150 150 0 0 1 352 168" markerEnd="url(#loop-ah)" />
          <path d="M 352 262 A 150 150 0 0 1 262 352" markerEnd="url(#loop-ah)" />
          <path d="M 168 352 A 150 150 0 0 1 78 262" markerEnd="url(#loop-ah)" />
          <path d="M 78 168 A 150 150 0 0 1 168 78" markerEnd="url(#loop-ah)" />
        </g>
        {node(140, 32, 150, 'PRESENCE')}
        {node(306, 195, 118, 'PROOF')}
        {node(140, 358, 150, 'RECALL')}
        {node(6, 195, 140, 'RESPONSE')}
        <text x="215" y="207" textAnchor="middle" fill="#A0A0A5" fontSize="11" fontFamily="ui-monospace, Menlo, monospace">THE</text>
        <text x="215" y="227" textAnchor="middle" fill="#C3F43B" fontSize="13" fontFamily="ui-monospace, Menlo, monospace" letterSpacing="2">OMNIPLY LOOP</text>
      </svg>
    </div>
  )
}

/* ── Verified stat band (same numbers + sources as the X-Ray funnel) ─────── */
export function StatBand({ onDark }: { onDark?: boolean }) {
  const stats = [
    { n: '132M', l: 'Americans research with AI assistants before they buy' },
    { n: '78%', l: 'of customers buy from whoever answers first' },
    { n: '100×', l: 'more likely to connect in 5 min vs. 30 min' },
    { n: '2 days', l: 'the average business response time' },
  ]
  const ink = onDark ? '#FFFFFF' : TOKENS.body
  const dim = onDark ? 'rgba(255,255,255,0.6)' : TOKENS.muted
  return (
    <div className="my-10">
      <div className="grid grid-cols-1 gap-6 border-y py-8 sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: onDark ? '#343434' : TOKENS.line }}>
        {stats.map((s) => (
          <div key={s.n}>
            <div className="text-4xl font-extrabold tracking-tight" style={{ color: s.n === '132M' ? (onDark ? TOKENS.lime : TOKENS.accentDeep) : ink }}>
              {s.n}
            </div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wider" style={{ color: dim }}>{s.l}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs" style={{ color: dim }}>
        Sources: Adyen Retail Report 2026 (132M Americans, 42&ndash;51% of online shoppers, research
        purchases with AI assistants; Visa: 25% use one daily) &middot; Oldroyd, Lead Response Management
        Study (InsideSales, 2007) &middot; Oldroyd, McElheran &amp; Elkington, &ldquo;The Short Life of
        Online Sales Leads,&rdquo; Harvard Business Review, March 2011 (1.25M leads: responding within an
        hour made firms nearly 7&times; as likely to qualify the lead as waiting an hour longer, 60&times;+
        vs. a day) &middot; Lead Connect survey. Every Omniply leak estimate is computed from your own
        answers and stated, adjustable assumptions.
      </p>
    </div>
  )
}

/* ── Slim branding header (site pages) ───────────────────────────────────── */
export function SiteHeader({ vertical }: { vertical?: string }) {
  return (
    <header
      className="sticky top-0 z-50 px-6 py-4"
      style={{ background: 'rgba(5,34,52,0.9)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #164863' }}
    >
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between">
        <a href="/home" className="flex items-center gap-3 font-mono text-sm font-bold tracking-[0.25em] text-white no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.svg" alt="Omniply" className="h-7 w-7" />
          <span>
            OMNIPLY{vertical ? <span className="font-normal text-white/50"> &middot; {vertical.toUpperCase()}</span> : null}
          </span>
        </a>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/articles" className="text-white/60 hover:text-white">
            Articles
          </Link>
          <a href="/walkthrough" className="hidden text-white/60 hover:text-white sm:inline">
            Walkthrough
          </a>
          <Link href="/about" className="hidden text-white/60 hover:text-white md:inline">
            About
          </Link>
          <Link href="/contact" className="hidden text-white/60 hover:text-white md:inline">
            Contact
          </Link>
          <a
            href={XRAY_URL}
            className="rounded-lg px-4 py-2 font-bold"
            style={{ background: TOKENS.lime, color: '#0B0B0C' }}
          >
            X-Ray My Practice
          </a>
        </nav>
      </div>
    </header>
  )
}

/* ── Site footer: Azavea Inc. attribution + legal/credibility links ──────── */
export function MarketingFooter() {
  const links = [
    { href: '/articles', label: 'Articles' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
    { href: '/data-security', label: 'Data & AI' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/refund-policy', label: 'Refunds' },
  ]
  return (
    <footer className="px-6 py-12 text-center text-sm" style={{ background: TOKENS.inkDeep, color: 'rgba(255,255,255,0.55)' }}>
      <p>Omniply &middot; Marketing autopilot for local practices</p>
      <p className="mt-2">
        <a href="/chiropractors" className="underline">Chiropractor? See the version built for your practice</a>
      </p>
      <nav className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-white/85">{l.label}</Link>
        ))}
      </nav>
      <p className="mt-6 text-white/40">
        &copy; {new Date().getFullYear()} Azavea Inc. All rights reserved. Omniply is a product of{' '}
        <a href="https://azavea.ai" className="underline hover:text-white/70" rel="noopener">Azavea Inc.</a>
      </p>
    </footer>
  )
}

/* ── Prose helpers for legal / info pages ────────────────────────────────── */
export function ProsePage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <main>
      <SiteHeader />
      <Section dark>
        <H2>{title}</H2>
        {updated && <p className="mb-8 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>Last updated: {updated}</p>}
        {children}
      </Section>
      <MarketingFooter />
    </main>
  )
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 mt-10 text-xl font-bold">{children}</h3>
}
