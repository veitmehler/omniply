/**
 * Shared marketing-site building blocks.
 *
 * Design system (2026-11-05, "Apple sales page" pass): every public page is
 * built from public/brand.css, the one stylesheet the static funnel pages
 * (/walkthrough, /x-ray, /intro/*) also link. Flat navy, grey and white
 * grounds in a strict rhythm; a 980px canvas for grids and an 800px measure
 * for prose; centered eyebrow + H2 on every section; one card style; pill
 * buttons; the lime accent on dark grounds and in markers only.
 * Copy style is dash-free (house rule). All diagrams are inline SVG.
 */
import React from 'react'
import Link from 'next/link'
import '../../../public/brand.css'

/** Palette, kept for the SVG diagrams (they cannot read CSS variables in attributes). */
export const TOKENS = {
  ink: '#0b2545',
  inkDeep: '#0b2545',
  paper: '#f5f5f7',
  body: '#1d1d1f',
  muted: '#6e6e73',
  accent: '#84B420', // lime-green readable on light grounds (diagram linework)
  accentDeep: '#5F8A14', // emphasis text on light grounds
  lime: '#C3F43B', // pure brand lime: dark grounds + markers only
  line: '#e2e2e7',
  darkLine: 'rgba(255,255,255,0.18)',
  darkCard: 'rgba(255,255,255,0.06)',
}

export const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? '#pricing'
export const XRAY_URL = '/x-ray'

/* ── Layout ─────────────────────────────────────────────────────────────── */
export type Tone = 'dark' | 'grey' | 'white'

/** Full-bleed section. `dark` is kept as a boolean alias for older pages. */
export function Section({
  children,
  dark,
  tone,
  id,
  hero,
  className,
}: {
  children: React.ReactNode
  dark?: boolean
  tone?: Tone
  id?: string
  hero?: boolean
  className?: string
}) {
  const t: Tone = tone ?? (dark ? 'dark' : 'grey')
  const cls = ['om-section', t === 'dark' ? 'is-dark' : t === 'grey' ? 'is-grey' : '', hero ? 'om-hero' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <section id={id} className={cls}>
      <div className="om-canvas">{children}</div>
    </section>
  )
}

export function Measure({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`om-measure${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  )
}

/** Centered section header: eyebrow + H2 (+ optional lead). */
export function SectionHead({ eyebrow, title, lead }: { eyebrow?: React.ReactNode; title: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <H2>{title}</H2>
      {lead && (
        <Measure>
          <p className="om-p om-lead is-center">{lead}</p>
        </Measure>
      )}
    </>
  )
}

/* ── Type ───────────────────────────────────────────────────────────────── */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="om-eyebrow">{children}</p>
}

export function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="om-h1">{children}</h1>
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="om-h2">{children}</h2>
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="om-h3">{children}</h3>
}

export function P({ children, lead, first, center }: { children: React.ReactNode; lead?: boolean; first?: boolean; center?: boolean }) {
  const cls = ['om-p', lead ? 'om-lead' : '', first ? 'is-first' : '', center ? 'is-center' : ''].filter(Boolean).join(' ')
  return <p className={cls}>{children}</p>
}

export function Who({ children }: { children: React.ReactNode }) {
  return <p className="om-who">{children}</p>
}

/* ── Buttons ────────────────────────────────────────────────────────────── */
export function Btn({
  children,
  href,
  ghost,
  onClick,
  type,
  disabled,
  lime,
}: {
  children: React.ReactNode
  href?: string
  ghost?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  lime?: boolean
}) {
  const cls = `om-btn ${ghost ? 'ghost' : 'primary'}${lime ? ' lime' : ''}`
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button type={type ?? 'button'} className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

/** Row of pill buttons, centered. */
export function CtaRow({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <>
      <div className="om-ctas">{children}</div>
      {sub && <p className="om-cta-sub">{sub}</p>}
    </>
  )
}

/** Single primary CTA (older API kept for existing pages). */
export function Cta({ children, sub, href }: { children: React.ReactNode; sub?: string; href?: string }) {
  return (
    <CtaRow sub={sub}>
      <Btn href={href ?? CHECKOUT_URL}>{children}</Btn>
    </CtaRow>
  )
}

/* ── Cards and lists ────────────────────────────────────────────────────── */
export function Grid({ cols, children, className, style }: { cols: 2 | 3 | 4; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`om-grid cols-${cols}${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  )
}

export function Card({ children, href, muted, className }: { children: React.ReactNode; href?: string; muted?: boolean; className?: string }) {
  const cls = `om-card${muted ? ' is-muted' : ''}${className ? ` ${className}` : ''}`
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }
  return <div className={cls}>{children}</div>
}

/** Title-left / body-right rows with hairline dividers. Uneven copy reads as intended. */
export function FeatureRows({ rows }: { rows: { title: React.ReactNode; body: React.ReactNode }[] }) {
  return (
    <div className="om-rows">
      {rows.map((r, i) => (
        <div className="om-row" key={i}>
          <h3 className="om-h3">{r.title}</h3>
          <div>{r.body}</div>
        </div>
      ))}
    </div>
  )
}

/** Numbered cards (the Loop, the three steps). */
export function NumberedCards({ items, cols = 2 }: { items: { title: React.ReactNode; body: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <Grid cols={cols}>
      {items.map((it, i) => (
        <div className="om-card" key={i}>
          <span className="om-n">{i + 1}</span>
          <h3 className="om-h3">{it.title}</h3>
          <p className="om-p">{it.body}</p>
        </div>
      ))}
    </Grid>
  )
}

export function Callout({ children, inset }: { children: React.ReactNode; inset?: boolean }) {
  return <div className={`om-callout${inset ? ' is-inset' : ''}`}>{children}</div>
}

export function CheckList({ children }: { children: React.ReactNode }) {
  return <ul className="om-check">{children}</ul>
}

/** One ✓ item: bold head, plain body. Replaces the old `Bullet`. */
export function Bullet({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <li>
      <b>{head}</b>
      <span>{children}</span>
    </li>
  )
}

/* ── Diagram 1: sawtooth vs compounding consistency ─────────────────────── */
export function ConsistencyGraph({ onDark, audienceLabel = 'Patient attention' }: { onDark?: boolean; audienceLabel?: string }) {
  const axis = onDark ? TOKENS.darkLine : TOKENS.line
  const dim = onDark ? 'rgba(255,255,255,0.6)' : TOKENS.muted
  const curve = onDark ? TOKENS.lime : TOKENS.accent
  const label = onDark ? TOKENS.lime : TOKENS.accentDeep
  return (
    <figure className="om-figure">
      <svg viewBox="0 0 560 260">
        <line x1="40" y1="220" x2="540" y2="220" stroke={axis} strokeWidth="2" />
        <line x1="40" y1="220" x2="40" y2="20" stroke={axis} strokeWidth="2" />
        <text x="290" y="248" textAnchor="middle" fontSize="13" fill={dim}>Months of marketing</text>
        <text x="18" y="120" textAnchor="middle" fontSize="13" fill={dim} transform="rotate(-90 18 120)">{audienceLabel}</text>
        {/* sawtooth: bursts that decay */}
        <path d="M40 218 L80 150 L120 210 L160 140 L200 205 L240 155 L280 212 L330 160 L380 214" fill="none" stroke={dim} strokeWidth="3" strokeDasharray="1 0" opacity="0.75" />
        <text x="385" y="228" fontSize="13" fill={dim} fontWeight="700">Bursts (most practices)</text>
        {/* compounding */}
        <path d="M40 218 C 200 210, 330 170, 420 100 C 470 62, 510 42, 540 30" fill="none" stroke={curve} strokeWidth="4" />
        <circle cx="540" cy="30" r="6" fill={curve} />
        <text x="530" y="60" textAnchor="end" fontSize="14" fill={label} fontWeight="700">Weekly, every week</text>
      </svg>
      <figcaption>Attention compounds only when content ships every week. Bursts reset to zero.</figcaption>
    </figure>
  )
}

/* ── Diagram 2: agent variance vs deterministic pipeline ────────────────── */
export function VarianceDiagram() {
  const outs = [58, 88, 118, 148, 178]
  return (
    <figure className="om-figure">
      <svg viewBox="0 0 560 240">
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
        <rect x="330" y="95" width="120" height="46" rx="10" fill="none" stroke={TOKENS.accent} strokeWidth="3" />
        <text x="390" y="123" textAnchor="middle" fontSize="14" fill={TOKENS.accentDeep} fontWeight="700">Omniply</text>
        <path d="M450 118 L505 118" stroke={TOKENS.accent} strokeWidth="3" />
        <rect x="505" y="103" width="46" height="30" rx="6" fill={TOKENS.accent} />
        <text x="528" y="122" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">✓</text>
        <text x="415" y="215" fontSize="13" fill={TOKENS.accentDeep} fontWeight="700">Same system, every time</text>
      </svg>
      <figcaption>Agents improvise. A pipeline repeats what works, with a human approval gate built in.</figcaption>
    </figure>
  )
}

/* ── Diagram 3: one brand in → five channels out (dark ground) ──────────── */
export function PipelineDiagram() {
  const channels = ['Articles', 'Newsletters', 'Social posts', 'Lead magnets', 'Review engine']
  return (
    <figure className="om-figure">
      <svg viewBox="0 0 560 300">
        <rect x="20" y="120" width="110" height="56" rx="10" fill="none" stroke="#fff" strokeWidth="2.5" />
        <text x="75" y="144" textAnchor="middle" fontSize="13" fill="#fff" fontWeight="700">Your voice</text>
        <text x="75" y="162" textAnchor="middle" fontSize="13" fill="#fff" fontWeight="700">Your brand</text>
        <rect x="215" y="118" width="130" height="60" rx="12" fill={TOKENS.lime} />
        <text x="280" y="143" textAnchor="middle" fontSize="14" fill="#1f2d05" fontWeight="800">Review gate</text>
        <text x="280" y="161" textAnchor="middle" fontSize="12" fill="#1f2d05">you approve, once</text>
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
      <figcaption>One system. Every channel your patients actually see. Published on schedule without you.</figcaption>
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
    <figure className="om-figure">
      <svg viewBox="0 0 560 260">
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
      <figcaption>Most prospects need many touches before they book. Almost nobody sustains that manually.</figcaption>
    </figure>
  )
}

/* ── Diagram 5: reactivation loop (light ground) ────────────────────────── */
export function ReactivationLoop({ visitsLabel = 'Patient visits', businessWord = 'practice' }: { visitsLabel?: string; businessWord?: string }) {
  return (
    <figure className="om-figure">
      <svg viewBox="0 0 560 260">
        <circle cx="280" cy="130" r="95" fill="none" stroke={TOKENS.line} strokeWidth="2.5" strokeDasharray="6 7" />
        {[
          { x: 280, y: 22, t1: visitsLabel, t2: '' },
          { x: 425, y: 130, t1: 'Life gets busy,', t2: 'they drift' },
          { x: 280, y: 238, t1: 'Your newsletter', t2: 'lands anyway' },
          { x: 135, y: 130, t1: 'They rebook', t2: '' },
        ].map((n, i) => (
          <g key={i}>
            <rect x={n.x - 62} y={n.y - 22} width="124" height="44" rx="10" fill="#fff" stroke={i === 2 ? TOKENS.accent : TOKENS.line} strokeWidth={i === 2 ? 3 : 2} />
            <text x={n.x} y={n.y - 2 + (n.t2 ? 0 : 6)} textAnchor="middle" fontSize="12.5" fill={i === 2 ? TOKENS.accentDeep : TOKENS.body} fontWeight="700">{n.t1}</text>
            {n.t2 && <text x={n.x} y={n.y + 14} textAnchor="middle" fontSize="12.5" fill={i === 2 ? TOKENS.accentDeep : TOKENS.body} fontWeight="700">{n.t2}</text>}
          </g>
        ))}
      </svg>
      <figcaption>Reactivation is the cheapest revenue in your {businessWord}. It only works if the reminder actually goes out.</figcaption>
    </figure>
  )
}

/* ── Pilot cards ────────────────────────────────────────────────────────── */
/** Factual pilot-program results. Card claims are real system outputs from
 * the pilot accounts, never invented quotes or customer-satisfaction claims. */
export const PILOT_CARDS = [
  {
    name: 'First Pilot Chiro Practice',
    body: 'The practice in our walkthrough video. Everything you’ll see there... the receptionist answering, quoting real fees, booking real calendar slots by chat and phone... is this practice running live, not a mock-up. Its assistant has handled 120+ conversations, and it can even take bookings directly from other AI assistants.',
  },
  {
    name: 'A Miami chiropractic clinic',
    body: 'Onboarded through our standard checkout: the account provisioned itself with no human setup, and the assistant and content engine were live the same day. The first content run delivered 5 articles, 90 social posts, 6 branded lead-magnet guides and a 30-day nurture sequence... before the week was out.',
  },
  {
    name: 'A wellness & longevity center',
    body: 'Live pilot: the assistant answers on website chat and WhatsApp in five languages and books twelve services, Saturdays included. In its first two weeks it held 38 conversations, while the content engine produced 9 newsletters and 6 branded lead-magnet guides... each one ready to approve from a phone.',
  },
]

export function PilotCards() {
  return (
    <Grid cols={3}>
      {PILOT_CARDS.map((c) => (
        <div className="om-card" key={c.name}>
          <h3 className="om-h3">{c.name}</h3>
          <p className="om-p">{c.body}</p>
        </div>
      ))}
    </Grid>
  )
}

/* ── Pricing block (number-free: the price lives on /walkthrough only) ───── */
export function PricingBlock({ vertical, peopleWord = 'patient', walkthroughHref = '/walkthrough' }: { vertical?: boolean; peopleWord?: string; walkthroughHref?: string }) {
  return (
    <div id="pricing" className="om-card" style={{ marginTop: 40 }}>
      <h3 className="om-h3" style={{ fontSize: 26 }}>One flat monthly subscription. Everything included. No contracts.</h3>
      <ul className="om-list" style={{ marginTop: 18 }}>
        <li><strong>All content included.</strong> Articles, newsletters, social posts, lead magnets. No per-piece charges, ever.</li>
        <li><strong>25,000 emails per month included.</strong> Your {peopleWord} list hears from you weekly and it costs you nothing extra.</li>
        <li><strong>No contracts.</strong> Cancel any month. Keep everything already published, because it is yours.</li>
      </ul>
      <Callout inset>
        <p className="om-p">
          <strong>Now do the honest math on the alternative.</strong> A part-time content person costs $2,500 to
          $5,000 a month and still needs your input for every piece. Doing it yourself costs 15 or more hours a
          week of {vertical ? 'adjustment-room time' : 'your highest-value time'}, and it is always the first
          thing dropped when the week gets busy. Which is exactly when the compounding curve resets to zero.
        </p>
      </Callout>
      <p className="om-p" style={{ marginTop: 24 }}>
        <a href={walkthroughHref} className="om-link" style={{ fontWeight: 700 }}>
          Watch the walkthrough video for all the details →
        </a>
      </p>
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
    <div className="om-faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p className="om-p">{item.a}</p>
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

/* ── Diagram 6: the Google map pack (light ground) ──────────────────────── */
export function MapPackDiagram({ query }: { query?: string }) {
  const q = query ?? 'chiropractor near me'
  return (
    <figure className="om-figure">
      <svg viewBox="0 0 560 330">
        <rect x="60" y="14" width="440" height="44" rx="22" fill="#fff" stroke={TOKENS.line} strokeWidth="2" />
        <circle cx="92" cy="36" r="9" fill="none" stroke={TOKENS.muted} strokeWidth="2.5" />
        <line x1="98" y1="43" x2="106" y2="51" stroke={TOKENS.muted} strokeWidth="2.5" />
        <text x="122" y="42" fontSize="15" fill={TOKENS.body}>{q}</text>
        <rect x="60" y="76" width="440" height="168" rx="12" fill="#fff" stroke={TOKENS.line} strokeWidth="2" />
        <text x="76" y="100" fontSize="11" fill={TOKENS.muted} fontWeight="700" letterSpacing="1">THE MAP PACK · ONLY 3 GET SHOWN</text>
        <rect x="72" y="110" width="416" height="38" rx="8" fill="none" stroke={TOKENS.accent} strokeWidth="3" />
        <rect x="82" y="120" width="90" height="10" rx="5" fill={TOKENS.ink} />
        <text x="182" y="130" fontSize="13" fill={TOKENS.accentDeep}>★★★★★</text>
        <text x="248" y="130" fontSize="12" fill={TOKENS.accentDeep} fontWeight="700">214 reviews · newest this week</text>
        <rect x="432" y="118" width="40" height="18" rx="9" fill={TOKENS.accent} />
        <text x="452" y="131" fontSize="11" fill="#fff" fontWeight="800" textAnchor="middle">YOU</text>
        <rect x="72" y="154" width="416" height="36" rx="8" fill="none" stroke={TOKENS.line} strokeWidth="2" />
        <rect x="82" y="164" width="80" height="9" rx="4.5" fill={TOKENS.line} />
        <text x="182" y="174" fontSize="13" fill={TOKENS.muted}>★★★★☆</text>
        <text x="248" y="174" fontSize="12" fill={TOKENS.muted}>41 reviews · newest 2 years ago</text>
        <rect x="72" y="196" width="416" height="36" rx="8" fill="none" stroke={TOKENS.line} strokeWidth="2" />
        <rect x="82" y="206" width="96" height="9" rx="4.5" fill={TOKENS.line} />
        <text x="182" y="216" fontSize="13" fill={TOKENS.muted}>★★★★☆</text>
        <text x="248" y="216" fontSize="12" fill={TOKENS.muted}>28 reviews · newest last year</text>
        <line x1="60" y1="262" x2="500" y2="262" stroke={TOKENS.line} strokeWidth="2" strokeDasharray="7 7" />
        <rect x="72" y="276" width="416" height="18" rx="6" fill={TOKENS.line} opacity="0.45" />
        <rect x="72" y="302" width="416" height="18" rx="6" fill={TOKENS.line} opacity="0.25" />
        <text x="280" y="259" textAnchor="middle" fontSize="11.5" fill={TOKENS.muted} fontWeight="700">EVERYONE ELSE · SCROLLED PAST</text>
      </svg>
      <figcaption>Google fills these three spots largely on reviews: how many, how recent, how steady.</figcaption>
    </figure>
  )
}

/* ── The Omniply Loop flywheel (dark ground) ────────────────────────────── */
export function LoopDiagram() {
  const node = (x: number, y: number, w: number, label: string) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={40} rx={20} fill={TOKENS.darkCard} stroke={TOKENS.darkLine} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fill="#FFFFFF" fontSize="12.5" fontWeight="700" letterSpacing="2">
        {label}
      </text>
    </g>
  )
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '40px 0 0' }}>
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
        <text x="215" y="207" textAnchor="middle" fill="#9fb0bd" fontSize="11" letterSpacing="2">THE</text>
        <text x="215" y="227" textAnchor="middle" fill="#C3F43B" fontSize="13" fontWeight="700" letterSpacing="2">OMNIPLY LOOP</text>
      </svg>
    </div>
  )
}

/* ── Verified stat band (same numbers + sources as the X-Ray funnel) ─────── */
export const STATS = [
  { n: '132M', l: 'Americans research with AI assistants before they buy' },
  { n: '78%', l: 'of customers buy from whoever answers first' },
  { n: '100×', l: 'more likely to connect in 5 min vs. 30 min' },
  { n: '2 days', l: 'the average business response time' },
]

export function StatBand({ sources = true, style }: { onDark?: boolean; sources?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <Grid cols={4}>
        {STATS.map((s) => (
          <div className="om-card om-stat" key={s.n}>
            <b>{s.n}</b>
            <span>{s.l}</span>
          </div>
        ))}
      </Grid>
      {sources && (
        <p className="om-sources">
          Sources: Adyen Retail Report 2026 (132M Americans, 42&ndash;51% of online shoppers, research
          purchases with AI assistants; Visa: 25% use one daily) &middot; Oldroyd, Lead Response Management
          Study (InsideSales, 2007) &middot; Oldroyd, McElheran &amp; Elkington, &ldquo;The Short Life of
          Online Sales Leads,&rdquo; Harvard Business Review, March 2011 (1.25M leads: responding within an
          hour made firms nearly 7&times; as likely to qualify the lead as waiting an hour longer, 60&times;+
          vs. a day) &middot; Lead Connect survey. Every Omniply leak estimate is computed from your own
          answers and stated, adjustable assumptions.
        </p>
      )}
    </div>
  )
}

/* ── Site header ────────────────────────────────────────────────────────── */
export function SiteHeader({ vertical, walkthroughHref = '/walkthrough', xrayHref = XRAY_URL }: { vertical?: string; walkthroughHref?: string; xrayHref?: string }) {
  return (
    <header className="om-header">
      <div className="om-header-inner">
        <a href="/home" className="om-wordmark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.svg" alt="" />
          <span>
            Omniply{vertical ? <small> &middot; {vertical}</small> : null}
          </span>
        </a>
        <nav className="om-nav">
          <Link href="/articles">Articles</Link>
          <a href={walkthroughHref}>Walkthrough</a>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <a href={xrayHref} className="om-btn lime small">
            X-Ray My Business
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
    { href: '/agents', label: 'For AI Agents' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/refund-policy', label: 'Refunds' },
  ]
  return (
    <footer className="om-footer">
      <p>Omniply &middot; Marketing autopilot for local practices</p>
      <p>
        <a href="/chiropractors">Chiropractor? See the version built for your practice</a>
        <span style={{ margin: '0 10px', opacity: 0.5 }}>·</span>
        <a href="/wellness">Run a wellness &amp; longevity center? See yours</a>
      </p>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href}>{l.label}</Link>
        ))}
      </nav>
      <p className="om-fine">
        &copy; {new Date().getFullYear()} Azavea Inc. All rights reserved. Omniply is a product of{' '}
        <a href="https://azavea.ai" rel="noopener">Azavea Inc.</a>
      </p>
    </footer>
  )
}

/* ── Prose pages (about, legal, agents): light, 800px measure ───────────── */
export function ProsePage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <main className="om">
      <SiteHeader />
      <Section tone="white">
        <Measure className="om-prose">
          <H2>{title}</H2>
          {updated && <p className="om-updated">Last updated: {updated}</p>}
          {children}
        </Measure>
      </Section>
      <MarketingFooter />
    </main>
  )
}
