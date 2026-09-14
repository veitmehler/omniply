'use client'

/**
 * Onboarding confirm-card components (onboarding plan — UI polish pass).
 * Each card receives the step's `card` payload and calls `onSubmit(answer)`
 * with exactly the shape the matching server commit expects.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { embedFetch } from '@/lib/embedSession'
import { HexColorInput, HexColorPicker } from 'react-colorful'

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'
const primaryBtn =
  'rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50'
const ghostBtn = 'rounded-lg border border-border px-4 py-2.5 text-sm text-foreground'

// ── business_confirm ──────────────────────────────────────────────────────────

const BUSINESS_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'organizationName', label: 'Business name' },
  { key: 'contactName', label: 'Your name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website', placeholder: 'https://…' },
  { key: 'address', label: 'Address' },
  { key: 'timezone', label: 'Timezone', placeholder: 'Australia/Brisbane' },
]

export function BusinessCard({
  card,
  disabled,
  onSubmit,
}: {
  card: Record<string, unknown>
  disabled: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(BUSINESS_FIELDS.map((f) => [f.key, String(card[f.key] ?? '')])),
  )
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {BUSINESS_FIELDS.map((f) => (
          <div key={f.key} className={f.key === 'address' ? 'sm:col-span-2' : ''}>
            <label className={labelCls}>{f.label}</label>
            <input
              className={inputCls}
              value={values[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <button
        className={`${primaryBtn} w-full`}
        disabled={disabled || !values.organizationName.trim()}
        onClick={() => onSubmit({ ...values, confirmed: true })}
      >
        That&apos;s correct ✓
      </button>
    </div>
  )
}

// ── logo_confirm ──────────────────────────────────────────────────────────────

export function LogoCard({
  card,
  disabled,
  onSubmit,
}: {
  card: { candidates?: string[] }
  disabled: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const candidates = card.candidates ?? []
  const [selected, setSelected] = useState<string | null>(candidates[0] ?? null)
  const [customUrl, setCustomUrl] = useState('')
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {candidates.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {candidates.map((url) => (
            <button
              key={url}
              onClick={() => setSelected(url)}
              disabled={disabled}
              className={`flex h-28 items-center justify-center rounded-lg border-2 bg-white p-2 ${
                selected === url ? 'border-primary' : 'border-border'
              }`}
            >
              {/* candidate logos come from arbitrary client sites — plain img on purpose */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="logo candidate" className="max-h-full max-w-full object-contain" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          I couldn&apos;t find a logo on your website — paste a direct image link below, or continue without one.
        </p>
      )}
      <div>
        <label className={labelCls}>…or paste a logo image URL</label>
        <input
          className={inputCls}
          value={customUrl}
          placeholder="https://…/logo.png"
          onChange={(e) => {
            setCustomUrl(e.target.value)
            if (e.target.value.trim()) setSelected(null)
          }}
          disabled={disabled}
        />
      </div>
      <div className="flex gap-2">
        <button
          className={`${primaryBtn} flex-1`}
          disabled={disabled || (!selected && !customUrl.trim())}
          onClick={() => onSubmit({ chosenUrl: customUrl.trim() || selected })}
        >
          Use this logo ✓
        </button>
        <button className={ghostBtn} disabled={disabled} onClick={() => onSubmit({ none: true })}>
          No logo
        </button>
      </div>
    </div>
  )
}

// ── brand_profile_confirm ─────────────────────────────────────────────────────

const PROFILE_FIELDS: { key: string; label: string; rows: number }[] = [
  { key: 'businessDescription', label: 'What your practice does', rows: 3 },
  { key: 'who', label: 'Who it serves (your ideal patient)', rows: 3 },
  { key: 'ourExperience', label: 'Your experience & process', rows: 3 },
  { key: 'articleGoal', label: 'What every article should achieve', rows: 2 },
  { key: 'specialInstructions', label: 'Your editorial stance', rows: 3 },
  { key: 'industry', label: 'Industry', rows: 1 },
]

export function ProfileCard({
  card,
  disabled,
  onSubmit,
}: {
  card: Record<string, unknown>
  disabled: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, String(card[f.key] ?? '')])),
  )
  // Specializations: registry CHECKBOXES (they route the content calendar — no
  // free text). Preselected from the site detection; confirm-or-correct.
  const registry = (card.availableSpecializations as string[] | undefined) ?? []
  const [specs, setSpecs] = useState<Set<string>>(() => {
    const detected = [
      ...((card.specializations as string[] | undefined) ?? []),
      ...(card.primarySpecialization ? [String(card.primarySpecialization)] : []),
    ].filter((s) => registry.includes(s))
    return new Set(detected)
  })
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {registry.length > 0 && (
        <div>
          <label className={labelCls}>Clinic specializations (check all that apply)</label>
          <div className="flex flex-wrap gap-2">
            {registry.map((key) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  specs.has(key) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={specs.has(key)}
                  disabled={disabled}
                  onChange={() =>
                    setSpecs((s) => {
                      const next = new Set(s)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                  }
                />
                {specs.has(key) ? '✓ ' : ''}
                {key.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>
      )}
      {PROFILE_FIELDS.map((f) => (
        <div key={f.key}>
          <label className={labelCls}>{f.label}</label>
          {f.rows === 1 ? (
            <input
              className={inputCls}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              disabled={disabled}
            />
          ) : (
            <textarea
              className={`${inputCls} resize-none`}
              rows={f.rows}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              disabled={disabled}
            />
          )}
        </div>
      ))}
      <button
        className={`${primaryBtn} w-full`}
        disabled={disabled || !values.businessDescription.trim() || !values.who.trim() || (registry.length > 0 && specs.size === 0)}
        onClick={() => onSubmit({ ...values, specializations: [...specs], confirmed: true })}
      >
        This is my brand ✓
      </button>
    </div>
  )
}

// ── photo (spokesperson for quote cards) ─────────────────────────────────────

export function PhotoCard({
  disabled,
  uploadPath,
  onSubmit,
}: {
  disabled: boolean
  uploadPath: string
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('photo', file, file.name)
      // embedFetch re-runs the SSO handshake on 401 — a raw fetch with a
      // render-time token 401s once the 15-min embed token expires mid-step.
      const res = await embedFetch(uploadPath, { method: 'POST', body: form })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Upload failed — try again')
        return
      }
      setPreview(data.url)
    } catch {
      setError('Upload failed — check your connection and try again')
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-full border-2 border-border bg-background">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your photo" className="h-full w-full object-cover" />
          ) : (
            <span className="text-3xl text-muted-foreground">👤</span>
          )}
        </div>
        <label className={`${ghostBtn} cursor-pointer`}>
          {uploading ? 'Uploading…' : preview ? 'Change photo' : 'Choose photo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          className={`${primaryBtn} flex-1`}
          disabled={disabled || uploading || !preview}
          onClick={() => onSubmit({ url: preview })}
        >
          Use this photo ✓
        </button>
        <button className={ghostBtn} disabled={disabled || uploading} onClick={() => onSubmit({ none: true })}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

// ── template_reveal ───────────────────────────────────────────────────────────

interface Palette {
  headerBackground?: string
  headerText?: string
  accent?: string
  button?: string
  bodyBackground?: string
  sectionTints?: string[]
}

const SWATCHES: { key: keyof Palette; label: string }[] = [
  { key: 'headerBackground', label: 'Header' },
  { key: 'accent', label: 'Links & accent' },
  { key: 'button', label: 'Buttons' },
  { key: 'bodyBackground', label: 'Background' },
]

/** Client-side mirror of the server preview so swatch edits re-render live. */
function previewHtml(orgName: string, logoUrl: string | null, p: Palette): string {
  const header = p.headerBackground ?? '#0b2545'
  const headerText = p.headerText ?? '#ffffff'
  const accent = p.accent ?? '#2a6f97'
  const body = p.bodyBackground ?? '#ffffff'
  const tints = p.sectionTints?.length ? p.sectionTints : ['#f2f6fa', '#fdf6ee']
  const btn = p.button ?? accent
  // Label: white or the dark header ink — whichever reads on the fill.
  const labelCandidates = relLuminance(header) < 0.4 ? ['#ffffff', header, '#1c2b33'] : ['#ffffff', '#1c2b33']
  const btnText =
    labelCandidates.find((c) => contrastRatio(c, btn) >= 4.5) ??
    labelCandidates.sort((a, b) => contrastRatio(b, btn) - contrastRatio(a, btn))[0]
  const esc = (s: string) => s.replace(/</g, '&lt;')
  return `<!doctype html><html><body style="margin:0;font-family:Arial,sans-serif;background:${body}">
<div style="max-width:600px;margin:0 auto">
  <div style="background:${header};color:${headerText};padding:24px;text-align:center">
    ${logoUrl ? `<img src="${logoUrl}" style="max-height:48px;max-width:70%"/>` : `<h1 style="margin:0;font-size:20px">${esc(orgName)}</h1>`}
    <p style="margin:6px 0 0;font-size:12px;opacity:.85">Your monthly health letter</p>
  </div>
  <div style="padding:18px 22px">
    <h2 style="color:${header};font-size:17px;margin:0 0 8px">Featured article headline</h2>
    <p style="font-size:13px;line-height:1.6;color:#333">How your newsletter body reads. Links look <a style="color:${accent}" href="#">like this</a>.</p>
  </div>
  <div style="background:${tints[0]};padding:14px 22px">
    <h3 style="margin:0 0 4px;font-size:14px;color:${header}">Quick tips</h3>
    <p style="margin:0;font-size:12px;color:#444">Alternating bands in your site's tones.</p>
  </div>
  <div style="padding:14px 22px"><a href="#" style="display:inline-block;background:${btn};color:${btnText};padding:9px 16px;border-radius:6px;font-size:13px;text-decoration:none">Book an appointment</a></div>
  <div style="background:${tints[1] ?? tints[0]};padding:14px 22px"><h3 style="margin:0 0 4px;font-size:14px;color:${header}">Seasonal offer</h3><p style="margin:0;font-size:12px;color:#444">Offer cards appear like this.</p></div>
  <div style="background:${header};color:${headerText};padding:14px 22px;text-align:center;font-size:11px;opacity:.9">${esc(orgName)}</div>
</div></body></html>`
}

/** WCAG relative luminance / contrast (mirrors the server-side palette rules). */
function relLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
}

function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function HexSwatch({
  value,
  label,
  disabled,
  onChange,
  alternates,
  lowContrast,
}: {
  value: string
  label: string
  disabled: boolean
  onChange: (hex: string) => void
  alternates?: string[]
  lowContrast?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground"
        aria-expanded={open}
        aria-label={`${label} color`}
      >
        <span
          className="h-5 w-5 rounded border border-border"
          style={{ background: valid ? value : '#888888' }}
        />
        <span>{label}</span>
        {lowContrast && (
          <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-600" title="Hard to read on your background color">
            low contrast
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 rounded-xl border border-border bg-card p-3 shadow-lg">
          <HexColorPicker color={valid ? value : '#888888'} onChange={(hex) => onChange(hex.toLowerCase())} />
          <div className="mt-2 flex items-center gap-1">
            <span className="font-mono text-xs text-muted-foreground">#</span>
            <HexColorInput
              color={valid ? value : '#888888'}
              onChange={(hex) => onChange(hex.toLowerCase())}
              className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-xs uppercase"
              aria-label={`${label} hex value`}
            />
          </div>
          {(alternates?.length ?? 0) > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Suggested:</span>
              {alternates!.map((alt) => (
                <button
                  key={alt}
                  type="button"
                  onClick={() => onChange(alt)}
                  className="h-5 w-5 rounded-full border border-border"
                  style={{ background: alt }}
                  title={alt}
                  aria-label={`use ${alt}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TemplateCard({
  card,
  disabled,
  onSubmit,
}: {
  card: {
    palette?: Palette
    logoUrl?: string | null
    logoVariants?: { lightUrl?: string; darkUrl?: string }
    organizationName?: string
  }
  disabled: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const [palette, setPalette] = useState<Palette>(card.palette ?? {})
  const [logoVariant, setLogoVariant] = useState<'light' | 'dark'>('light')
  const variants = card.logoVariants ?? {}
  const hasBothVariants = Boolean(variants.lightUrl && variants.darkUrl)
  const activeLogo =
    (logoVariant === 'dark' ? variants.darkUrl : variants.lightUrl) ?? card.logoUrl ?? null
  const html = useMemo(
    () => previewHtml(card.organizationName ?? 'Your Practice', activeLogo, palette),
    [card.organizationName, activeLogo, palette],
  )
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <iframe
        srcDoc={html}
        title="Your newsletter"
        className="h-96 w-full rounded-lg border border-border bg-white"
        sandbox=""
      />
      {hasBothVariants && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Logo on header:</span>
          {(['light', 'dark'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => setLogoVariant(v)}
              className={`rounded-lg border px-2 py-1.5 ${
                logoVariant === v ? 'border-primary ring-2 ring-primary/40' : 'border-border'
              }`}
              // Each variant on the ground it's made for — a dark logo on the
              // dark header swatch would be invisible.
              style={{ background: v === 'light' ? ((palette.headerBackground as string) ?? '#0b2545') : '#ffffff' }}
              aria-pressed={logoVariant === v}
              title={v === 'light' ? 'Light logo (for dark headers)' : 'Dark logo (for light headers)'}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v === 'light' ? variants.lightUrl : variants.darkUrl} alt={`${v} logo`} className="h-6" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {SWATCHES.map((s) => {
          const value = (palette[s.key] as string) ?? '#888888'
          const bg = (palette.bodyBackground as string) ?? '#ffffff'
          // Readability warning for the roles that render as text/controls on the body.
          const checkContrast = s.key === 'accent' || s.key === 'button'
          const lowContrast =
            checkContrast && /^#[0-9a-fA-F]{6}$/.test(value) && /^#[0-9a-fA-F]{6}$/.test(bg)
              ? contrastRatio(value, bg) < 4.5
              : false
          return (
            <HexSwatch
              key={s.key}
              value={value}
              label={s.label}
              disabled={disabled}
              onChange={(hex) => setPalette((p) => ({ ...p, [s.key]: hex }))}
              alternates={((palette as { alternates?: Record<string, string[]> }).alternates?.[s.key] ?? []).slice(0, 3)}
              lowContrast={lowContrast}
            />
          )
        })}
      </div>
      <button
        className={`${primaryBtn} w-full`}
        disabled={disabled}
        onClick={() => onSubmit({ palette, logoVariant, confirmed: true })}
      >
        I love it — that&apos;s my newsletter ✓
      </button>
    </div>
  )
}

// ── offers ────────────────────────────────────────────────────────────────────

interface OfferDraft {
  title: string
  body: string
  ctaLabel?: string
  month?: number
}

const MONTHS = ['—', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function OffersCard({
  card,
  disabled,
  onSubmit,
}: {
  card: { offers?: OfferDraft[] }
  disabled: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const [offers, setOffers] = useState<(OfferDraft & { kept: boolean })[]>(() =>
    (card.offers ?? []).map((o) => ({ ...o, kept: true })),
  )
  const keptCount = offers.filter((o) => o.kept).length
  function update(i: number, patch: Partial<OfferDraft & { kept: boolean }>) {
    setOffers((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {offers.map((o, i) => (
          <div
            key={i}
            className={`rounded-lg border p-2.5 ${o.kept ? 'border-border' : 'border-border opacity-40'}`}
          >
            <div className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-xs font-semibold text-primary">{MONTHS[o.month ?? 0]}</span>
              <input
                className={`${inputCls} flex-1 !py-1 text-xs font-medium`}
                value={o.title}
                onChange={(e) => update(i, { title: e.target.value })}
                disabled={disabled || !o.kept}
              />
              <button
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => update(i, { kept: !o.kept })}
                disabled={disabled}
              >
                {o.kept ? 'drop' : 'keep'}
              </button>
            </div>
            {o.kept && (
              <textarea
                className={`${inputCls} mt-1.5 resize-none !py-1 text-xs`}
                rows={2}
                value={o.body}
                onChange={(e) => update(i, { body: e.target.value })}
                disabled={disabled}
              />
            )}
          </div>
        ))}
      </div>
      <button
        className={`${primaryBtn} w-full`}
        disabled={disabled || keptCount === 0}
        onClick={() =>
          onSubmit({ offers: offers.filter((o) => o.kept).map(({ kept: _kept, ...o }) => o), confirmed: true })
        }
      >
        Save {keptCount} offer{keptCount === 1 ? '' : 's'} ✓
      </button>
    </div>
  )
}

// ── wordpress ─────────────────────────────────────────────────────────────────

export function WordpressCard({
  card,
  disabled,
  downloadPath,
  onSubmit,
}: {
  card: { website?: string }
  disabled: boolean
  downloadPath?: string
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const [siteUrl, setSiteUrl] = useState(card.website ?? '')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [downloading, setDownloading] = useState(false)
  async function downloadLinktree() {
    if (!downloadPath) return
    setDownloading(true)
    try {
      const res = await embedFetch(downloadPath)
      if (!res.ok) return
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'linktree.html'
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>Log in to your WordPress admin</li>
        <li>Users → Profile → scroll to <b>Application Passwords</b></li>
        <li>Name it &quot;Omniply&quot;, click <b>Add New</b>, copy the generated password</li>
      </ol>
      <div>
        <label className={labelCls}>WordPress site URL</label>
        <input className={inputCls} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} disabled={disabled} placeholder="https://yourclinic.com.au" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Username</label>
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} disabled={disabled} />
        </div>
        <div>
          <label className={labelCls}>Application Password</label>
          <input className={inputCls} type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} disabled={disabled} placeholder="xxxx xxxx xxxx xxxx" />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className={`${primaryBtn} flex-1`}
          disabled={disabled || !siteUrl.trim() || !username.trim() || !appPassword.trim()}
          onClick={() => onSubmit({ mode: 'connect', siteUrl: siteUrl.trim(), username: username.trim(), appPassword: appPassword.trim() })}
        >
          Connect & verify ✓
        </button>
        <button className={ghostBtn} disabled={disabled} onClick={() => onSubmit({ mode: 'skip' })}>
          No WordPress
        </button>
      </div>
      {downloadPath && (
        <p className="text-xs text-muted-foreground">
          Not on WordPress? With WordPress we also publish a ready-made link-in-bio page to your site automatically —
          without it, you can{' '}
          <button
            type="button"
            className="underline"
            disabled={disabled || downloading}
            onClick={() => void downloadLinktree()}
          >
            {downloading ? 'preparing…' : 'download it as an HTML file'}
          </button>{' '}
          and upload it to your own hosting (best after finishing this setup, so it includes all your links).
        </p>
      )}
    </div>
  )
}

// ── socials ───────────────────────────────────────────────────────────────────

export function SocialsCard({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>In the left sidebar, open <b>Marketing → Social Planner</b></li>
        <li>Click <b>Connect</b> and link Facebook, Instagram and LinkedIn</li>
        <li>Come back here — I&apos;ll pick them up automatically</li>
      </ol>
      <button className={`${primaryBtn} w-full`} disabled={disabled} onClick={() => onSubmit({ done: true })}>
        I&apos;ve connected my accounts ✓
      </button>
    </div>
  )
}

// ── Front Desk Questions (chat-kb plan E) ────────────────────────────────────

interface Practitioner { name: string; gender: string; hours: string }

export function FrontDeskCard({ disabled, onSubmit }: { disabled: boolean; onSubmit: (a: unknown, echo: string) => void }) {
  const [funds, setFunds] = useState('')
  const [hicaps, setHicaps] = useState(false)
  const [medicare, setMedicare] = useState(false)
  const [workersComp, setWorkersComp] = useState(false)
  const [motor, setMotor] = useState(false)
  const [fvDuration, setFvDuration] = useState('')
  const [fvDesc, setFvDesc] = useState('')
  const [fvBring, setFvBring] = useState('')
  const [freeOffered, setFreeOffered] = useState(false)
  const [freeTerms, setFreeTerms] = useState('')
  const [priceShare, setPriceShare] = useState(false)
  const [priceStd, setPriceStd] = useState('')
  const [priceDisc, setPriceDisc] = useState('')
  const [bookHow, setBookHow] = useState('')
  const [cancelPolicy, setCancelPolicy] = useState('')
  const [practitioners, setPractitioners] = useState<Practitioner[]>([{ name: '', gender: 'female', hours: '' }])
  const [treatChildren, setTreatChildren] = useState(true)
  const [treatPregnancy, setTreatPregnancy] = useState(true)
  const [treatSeniors, setTreatSeniors] = useState(true)
  const [hasAgeLimit, setHasAgeLimit] = useState(false)
  const [ageLimit, setAgeLimit] = useState('')
  const [referrals, setReferrals] = useState('')
  const [payMethods, setPayMethods] = useState<string[]>(['Card'])
  const [payOther, setPayOther] = useState('')
  const [access, setAccess] = useState('')
  const [languages, setLanguages] = useState('')
  const [afterHours, setAfterHours] = useState('')

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm'
  const label = 'block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-3'
  const check = 'flex items-center gap-2 text-sm py-0.5'

  const togglePay = (m: string) =>
    setPayMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))

  const submit = () =>
    onSubmit(
      {
        insurance: { funds, hicaps, medicareCarePlans: medicare, workersComp, motorAccident: motor },
        firstVisit: { duration: fvDuration, description: fvDesc, bring: fvBring },
        freeAssessment: { offered: freeOffered, terms: freeTerms },
        pricing: { share: priceShare, standard: priceStd, discounts: priceDisc },
        bookingPolicy: { how: bookHow, cancellation: cancelPolicy },
        practitioners: practitioners.filter((p) => p.name.trim()),
        treats: { children: treatChildren, pregnancy: treatPregnancy, seniors: treatSeniors, ageLimit: hasAgeLimit ? ageLimit : null },
        referrals,
        payment: { methods: payMethods, other: payOther },
        access,
        languages,
        afterHours,
      },
      'Front desk answers saved ✓',
    )

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1 max-h-[70vh] overflow-y-auto">
      <p className={label}>Insurance &amp; funds</p>
      <input className={input} value={funds} onChange={(e) => setFunds(e.target.value)} placeholder="Funds/insurers you accept (e.g. Bupa, Medibank, HCF…)" />
      <label className={check}><input type="checkbox" checked={hicaps} onChange={(e) => setHicaps(e.target.checked)} /> HICAPS / instant claims terminal</label>
      <label className={check}><input type="checkbox" checked={medicare} onChange={(e) => setMedicare(e.target.checked)} /> Medicare care plans (EPC/CDM)</label>
      <label className={check}><input type="checkbox" checked={workersComp} onChange={(e) => setWorkersComp(e.target.checked)} /> Workers&apos; compensation</label>
      <label className={check}><input type="checkbox" checked={motor} onChange={(e) => setMotor(e.target.checked)} /> Motor accident claims</label>

      <p className={label}>First visit</p>
      <input className={input} value={fvDuration} onChange={(e) => setFvDuration(e.target.value)} placeholder="How long? (e.g. 45 minutes)" />
      <textarea className={input} rows={2} value={fvDesc} onChange={(e) => setFvDesc(e.target.value)} placeholder="What happens during it?" />
      <input className={input} value={fvBring} onChange={(e) => setFvBring(e.target.value)} placeholder="What should patients bring or wear?" />
      <label className={check}><input type="checkbox" checked={freeOffered} onChange={(e) => setFreeOffered(e.target.checked)} /> We offer a free initial assessment</label>
      {freeOffered && (
        <input className={input} value={freeTerms} onChange={(e) => setFreeTerms(e.target.value)} placeholder="Terms (required by advertising rules, e.g. new patients only, 15 min)" />
      )}

      <p className={label}>Pricing</p>
      <label className={check}><input type="checkbox" checked={priceShare} onChange={(e) => setPriceShare(e.target.checked)} /> The assistant may share prices in chat</label>
      {priceShare && (
        <>
          <input className={input} value={priceStd} onChange={(e) => setPriceStd(e.target.value)} placeholder="Standard rates (e.g. first visit $95, standard visit $65)" />
          <input className={input} value={priceDisc} onChange={(e) => setPriceDisc(e.target.value)} placeholder="Structured discounts with terms (optional, e.g. concession $55)" />
        </>
      )}

      <p className={label}>Booking &amp; cancellation</p>
      <input className={input} value={bookHow} onChange={(e) => setBookHow(e.target.value)} placeholder="How do patients book / reschedule / cancel?" />
      <input className={input} value={cancelPolicy} onChange={(e) => setCancelPolicy(e.target.value)} placeholder="Cancellation policy (notice period, fees)" />

      <p className={label}>Practitioners</p>
      {practitioners.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input className={input} value={p.name} onChange={(e) => setPractitioners(practitioners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
          <select className="rounded-lg border border-input bg-background px-2 text-sm" value={p.gender} onChange={(e) => setPractitioners(practitioners.map((x, j) => (j === i ? { ...x, gender: e.target.value } : x)))}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
          <input className={input} value={p.hours} onChange={(e) => setPractitioners(practitioners.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} placeholder="Works (e.g. Mon–Wed, Fri am)" />
        </div>
      ))}
      <button type="button" className="text-xs text-primary underline" onClick={() => setPractitioners([...practitioners, { name: '', gender: 'female', hours: '' }])}>
        + Add practitioner
      </button>

      <p className={label}>Who you treat</p>
      <label className={check}><input type="checkbox" checked={treatChildren} onChange={(e) => setTreatChildren(e.target.checked)} /> Children</label>
      <label className={check}><input type="checkbox" checked={treatPregnancy} onChange={(e) => setTreatPregnancy(e.target.checked)} /> Pregnancy</label>
      <label className={check}><input type="checkbox" checked={treatSeniors} onChange={(e) => setTreatSeniors(e.target.checked)} /> Seniors</label>
      <label className={check}><input type="checkbox" checked={hasAgeLimit} onChange={(e) => setHasAgeLimit(e.target.checked)} /> Age limit applies</label>
      {hasAgeLimit && <input className={input} value={ageLimit} onChange={(e) => setAgeLimit(e.target.value)} placeholder="Describe the age limit" />}

      <p className={label}>Referrals</p>
      <input className={input} value={referrals} onChange={(e) => setReferrals(e.target.value)} placeholder="Do patients need a GP referral? (generally / care plans / insurance)" />

      <p className={label}>Payment methods</p>
      {['Card', 'Cash', 'HICAPS', 'Payment plans'].map((m) => (
        <label key={m} className={check}><input type="checkbox" checked={payMethods.includes(m)} onChange={() => togglePay(m)} /> {m}</label>
      ))}
      <input className={input} value={payOther} onChange={(e) => setPayOther(e.target.value)} placeholder="Additional options:" />

      <p className={label}>Getting there</p>
      <input className={input} value={access} onChange={(e) => setAccess(e.target.value)} placeholder="Parking, public transport, wheelchair access" />

      <p className={label}>Languages &amp; after hours</p>
      <input className={input} value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Languages the team speaks" />
      <input className={input} value={afterHours} onChange={(e) => setAfterHours(e.target.value)} placeholder="What should patients do outside opening hours?" />

      <button onClick={submit} disabled={disabled} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
        Save front desk answers
      </button>
    </div>
  )
}

// ── KB review (chat-kb plan F1) ──────────────────────────────────────────────

export function KbReviewCard({ card, disabled, onSubmit }: { card: Record<string, unknown>; disabled: boolean; onSubmit: (a: unknown, echo: string) => void }) {
  const [faqs, setFaqs] = useState<{ q: string; a: string }[]>(
    Array.isArray(card.faqs) ? (card.faqs as { q: string; a: string }[]) : [],
  )
  const [openingHours, setOpeningHours] = useState((card.openingHours as string) ?? '')
  const [phone, setPhone] = useState((card.organizationPhone as string) ?? '')
  const [bookingUrl, setBookingUrl] = useState((card.bookingUrl as string) ?? '')

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm'
  const label = 'block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-3'

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1 max-h-[70vh] overflow-y-auto">
      <p className={label}>Business basics</p>
      <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Practice phone" />
      <input className={input} value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="Booking page URL" />
      <textarea
        className={input}
        rows={3}
        value={openingHours}
        onChange={(e) => setOpeningHours(e.target.value)}
        placeholder={card.hoursSource === 'google' ? 'Hours (detected from your Google listing — edit to override)' : 'Opening hours (one line per day)'}
      />

      <p className={label}>What the assistant will know ({faqs.length} answers)</p>
      {faqs.map((f, i) => (
        <div key={i} className="rounded-lg border border-border p-2 space-y-1">
          <input className={input} value={f.q} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
          <textarea className={input} rows={2} value={f.a} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
          <button type="button" className="text-xs text-destructive underline" onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="text-xs text-primary underline" onClick={() => setFaqs([...faqs, { q: '', a: '' }])}>
        + Add a question
      </button>

      <button
        onClick={() => onSubmit({ faqs, openingHours, organizationPhone: phone, bookingUrl }, 'Knowledge base approved ✓')}
        disabled={disabled}
        className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Approve knowledge base
      </button>
    </div>
  )
}
