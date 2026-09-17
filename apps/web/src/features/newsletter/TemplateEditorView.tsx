'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ArrowLeft, Save, RefreshCw, CheckCircle2 } from 'lucide-react'

type Template = Record<string, string>
type Delivery = Record<string, string>

// [key, label, default] — defaults mirror the renderer so the pickers never show black.
const COLOR_FIELDS: Array<[string, string, string]> = [
  ['nlHeaderBgColor', 'Header background', '#fa00bb'],
  ['nlFooterBgColor', 'Footer background', '#011328'],
  ['nlSectionColor1', 'General bands (tips, joke, video, trivia)', '#fa00bb'],
  ['nlSectionColor2', 'Curated article bands', '#00bbf9'],
  ['nlSectionColor3', 'Articles & “Did you know” bands', '#00142b'],
  ['nlSectionColor4', 'Recipe bands', '#00dd81'],
  ['nlBandTextColor', 'Band text color (all bands)', '#ffffff'],
  ['nlFooterTextColor', 'Footer text color', '#ffffff'],
  ['nlFontColor', 'Body text color', '#00142b'],
  ['nlLinkColor', 'Link color', '#fa00bb'],
]
const WEIGHTS = ['400', '500', '600', '700', '800']
// Open Sans first = default. Google Fonts (imported in the email) + web-safe fonts.
const FONT_OPTIONS = [
  'Open Sans', 'Roboto', 'Lato', 'Montserrat', 'Poppins', 'Merriweather', 'Playfair Display',
  'Arial', 'Georgia', 'Helvetica', 'Trebuchet MS', 'Times New Roman', 'Verdana',
]

export function TemplateEditorView({ embedMode = false }: { embedMode?: boolean } = {}) {
  const [template, setTemplate] = useState<Template>({})
  const [sectionsDisabled, setSectionsDisabled] = useState<string[]>([])
  const [audienceTags, setAudienceTags] = useState<{ id: string; name: string }[]>([])
  const [locationTags, setLocationTags] = useState<{ id: string; name: string }[]>([])
  const [addTagId, setAddTagId] = useState('')
  const [delivery, setDelivery] = useState<Delivery>({})
  const [ghlConnected, setGhlConnected] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshPreview = useCallback(async (t: Template) => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/newsletters/template-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: t }),
      })
      if (res.ok) {
        const data = await res.json()
        setPreviewHtml(data.html ?? '')
      }
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/newsletters/settings', { cache: 'no-store' })
        if (!res.ok) {
          setError(`HTTP ${res.status}`)
          return
        }
        const data = await res.json()
        const t: Template = {}
        for (const [k, v] of Object.entries(data.template ?? {})) {
          if (k === 'nlSectionsDisabled') continue // Json array — own state below
          t[k] = (v as string) ?? ''
        }
        setSectionsDisabled(Array.isArray(data.template?.nlSectionsDisabled) ? data.template.nlSectionsDisabled : [])
        setAudienceTags(Array.isArray(data.audienceTags) ? data.audienceTags : [])
        fetch('/api/ghl/tags', { cache: 'no-store' })
          .then(async (r) => (r.ok ? (await r.json()).tags ?? [] : []))
          .then(setLocationTags)
          .catch(() => setLocationTags([]))
        const d: Delivery = {}
        for (const [k, v] of Object.entries(data.delivery ?? {})) d[k] = (v as string) ?? ''
        setTemplate(t)
        setDelivery(d)
        setGhlConnected(!!data.ghlConnected)
        await refreshPreview(t)
      } catch (err) {
        setError((err as Error).message ?? 'Failed to load settings')
      } finally {
        setLoading(false)
      }
    })()
  }, [refreshPreview])

  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [processingLogo, setProcessingLogo] = useState(false)

  function setT(key: string, value: string) {
    setTemplate((prev) => ({ ...prev, [key]: value }))
  }

  const SLOT_FIELD: Record<string, string> = {
    source: 'nlLogoSourceUrl',
    light: 'nlLogoLightUrl',
    dark: 'nlLogoDarkUrl',
    original: 'nlLogoColorUrl',
  }

  async function uploadLogoSlot(file: File, slot: 'source' | 'light' | 'dark' | 'original'): Promise<string | null> {
    setUploadingLogo(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('slot', slot)
      const res = await fetch('/api/newsletters/logo', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Logo upload failed')
        return null
      }
      setTemplate((prev) => ({ ...prev, [SLOT_FIELD[slot]]: data.url }))
      return data.url as string
    } catch (err) {
      setError((err as Error).message ?? 'Logo upload failed')
      return null
    } finally {
      setUploadingLogo(false)
    }
  }

  /** Generate light + dark variants from the stored source logo. */
  async function processSourceLogo() {
    setProcessingLogo(true)
    setError(null)
    try {
      const res = await fetch('/api/newsletters/logo/process', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Logo processing failed')
        return
      }
      setTemplate((prev) => ({ ...prev, nlLogoLightUrl: data.lightUrl, nlLogoDarkUrl: data.darkUrl, ...(data.colorUrl ? { nlLogoColorUrl: data.colorUrl } : {}) }))
      setNotice('Logo processed into light + dark versions.')
    } catch (err) {
      setError((err as Error).message ?? 'Logo processing failed')
    } finally {
      setProcessingLogo(false)
    }
  }

  async function onSourceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const url = await uploadLogoSlot(file, 'source')
    if (url) await processSourceLogo()
  }

  async function onOverrideUpload(e: React.ChangeEvent<HTMLInputElement>, slot: 'light' | 'dark' | 'original') {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await uploadLogoSlot(file, slot)
  }

  async function removeLogoSlot(slot: 'source' | 'light' | 'dark') {
    setUploadingLogo(true)
    try {
      await fetch(`/api/newsletters/logo?slot=${slot}`, { method: 'DELETE' })
      setTemplate((prev) => ({ ...prev, [SLOT_FIELD[slot]]: '' }))
    } catch {
      /* ignore */
    } finally {
      setUploadingLogo(false)
    }
  }
  function setD(key: string, value: string) {
    setDelivery((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/newsletters/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: { ...template, nlSectionsDisabled: sectionsDisabled },
          delivery: { ...delivery, newsletterTagIds: audienceTags },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setNotice('Saved.')
      await refreshPreview(template)
    } catch (err) {
      setError((err as Error).message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {!embedMode && (
        <Link
          href="/newsletter"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Newsletter
        </Link>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Template &amp; delivery</h1>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>

      {notice && <div className="mb-3 text-sm text-green-700">{notice}</div>}
      {error && (
        <div className="mb-3 flex items-start gap-2 text-sm text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1-column (Veit 2026-09-16): email-width preview on top, controls
          below — col-reverse keeps DOM order, preview renders first. */}
      <div className="flex flex-col-reverse gap-6">
        <div className="space-y-4">
          {/* Appearance */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h3>
            <div className="space-y-3">
              {COLOR_FIELDS.map(([key, label, def]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <label className="text-sm text-foreground">{label}</label>
                  <input
                    type="color"
                    value={template[key] || def}
                    onChange={(e) => setT(key, e.target.value)}
                    className="h-8 w-12 cursor-pointer rounded border border-border"
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Select a font</label>
                <select
                  value={template.nlFontFamily || 'Open Sans'}
                  onChange={(e) => setT('nlFontFamily', e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Heading weight</label>
                  <select
                    value={template.nlHeadingFontWeight || '700'}
                    onChange={(e) => setT('nlHeadingFontWeight', e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {WEIGHTS.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Body weight</label>
                  <select
                    value={template.nlBodyFontWeight || '400'}
                    onChange={(e) => setT('nlBodyFontWeight', e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {WEIGHTS.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Logo: upload once → auto light + dark variants */}
              <div className="border-t border-border pt-3">
                <label className="mb-1 block text-xs font-medium text-foreground">Logo</label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Upload your logo once — we keep a cleaned full-colour version and generate white (for dark
                  backgrounds) and dark (for light backgrounds) silhouettes automatically. Replace any manually if needed.
                </p>
                <div className="mb-3 flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={onSourceUpload}
                    className="text-sm"
                  />
                  {(uploadingLogo || processingLogo) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {processingLogo && <span className="text-xs text-muted-foreground">Generating variants…</span>}
                </div>

                {(template.nlLogoColorUrl || template.nlLogoLightUrl || template.nlLogoDarkUrl) && (
                  <div className="mb-3 grid grid-cols-3 gap-3">
                    {/* Original (full colour) on a neutral swatch */}
                    <div className="rounded-lg border border-border p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted-foreground">Original (full colour)</span>
                        <label className="cursor-pointer text-[11px] text-blue-600 hover:underline">
                          Replace
                          <input type="file" accept="image/png,image/svg+xml" onChange={(e) => onOverrideUpload(e, 'original')} className="hidden" />
                        </label>
                      </div>
                      <div className="flex h-20 items-center justify-center rounded" style={{ backgroundColor: '#eef1f4' }}>
                        {template.nlLogoColorUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={template.nlLogoColorUrl} alt="Original logo" className="max-h-16 max-w-[90%]" />
                        ) : (
                          <span className="text-[11px] text-black/40">—</span>
                        )}
                      </div>
                    </div>
                    {/* Light variant on a dark swatch */}
                    <div className="rounded-lg border border-border p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted-foreground">Light (dark bg)</span>
                        <label className="cursor-pointer text-[11px] text-blue-600 hover:underline">
                          Replace
                          <input type="file" accept="image/png,image/svg+xml" onChange={(e) => onOverrideUpload(e, 'light')} className="hidden" />
                        </label>
                      </div>
                      <div className="flex h-20 items-center justify-center rounded" style={{ backgroundColor: '#011328' }}>
                        {template.nlLogoLightUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={template.nlLogoLightUrl} alt="Light logo" className="max-h-16 max-w-[90%]" />
                        ) : (
                          <span className="text-[11px] text-white/50">—</span>
                        )}
                      </div>
                    </div>
                    {/* Dark variant on a light swatch */}
                    <div className="rounded-lg border border-border p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted-foreground">Dark (light bg)</span>
                        <label className="cursor-pointer text-[11px] text-blue-600 hover:underline">
                          Replace
                          <input type="file" accept="image/png,image/svg+xml" onChange={(e) => onOverrideUpload(e, 'dark')} className="hidden" />
                        </label>
                      </div>
                      <div className="flex h-20 items-center justify-center rounded" style={{ backgroundColor: '#f5f5f5' }}>
                        {template.nlLogoDarkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={template.nlLogoDarkUrl} alt="Dark logo" className="max-h-16 max-w-[90%]" />
                        ) : (
                          <span className="text-[11px] text-black/40">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {template.nlLogoSourceUrl && (
                  <div className="mb-3 flex items-center gap-3">
                    <button
                      onClick={processSourceLogo}
                      disabled={processingLogo}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Re-process
                    </button>
                    <button onClick={() => removeLogoSlot('source')} disabled={uploadingLogo} className="text-xs text-red-600 hover:underline">
                      Remove logo
                    </button>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Body text size: {parseInt(template.nlBodyFontSize || '0', 10) || 20}px
                  </label>
                  <input type="range" min={16} max={26} step={1} value={parseInt(template.nlBodyFontSize || '0', 10) || 20} onChange={(e) => setT('nlBodyFontSize', e.target.value)} className="w-full" />
                </div>

                {/* Default sections (template-level; per-edition overrides live
                    on each edition's review page) */}
                <div className="border-t border-border pt-3">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Sections included by default</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      ['video', 'Video'], ['teaser1', 'Teaser 1'], ['teaser2', 'Teaser 2'], ['teaser3', 'Teaser 3'],
                      ['tips', 'Tips of the day'], ['didYouKnow', 'Did you know'], ['joke', 'Joke'], ['trivia', 'Trivia'],
                      ['recipe', 'Recipe 1'], ['recipe2', 'Recipe 2'], ['secondaryArticle', 'Secondary article'],
                      ['seasonalOffer', 'Seasonal offer'], ['evergreenOffer', 'Evergreen offer'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!sectionsDisabled.includes(key)}
                          onChange={() =>
                            setSectionsDisabled((prev) =>
                              prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Header / footer placement: variant + size */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Header logo</label>
                    <select
                      value={template.nlHeaderLogoVariant || 'auto'}
                      onChange={(e) => setT('nlHeaderLogoVariant', e.target.value)}
                      className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="auto">Auto (by header colour)</option>
                      <option value="original">Original (full colour)</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      Width: {parseInt(template.nlLogoWidth || '0', 10) || 320}px
                    </label>
                    <input type="range" min={40} max={600} step={10} value={parseInt(template.nlLogoWidth || '0', 10) || 320} onChange={(e) => setT('nlLogoWidth', e.target.value)} className="w-full" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Footer logo</label>
                    <select
                      value={template.nlFooterLogoVariant || 'auto'}
                      onChange={(e) => setT('nlFooterLogoVariant', e.target.value)}
                      className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="auto">Auto (by footer colour)</option>
                      <option value="original">Original (full colour)</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      Width: {parseInt(template.nlFooterLogoWidth || '0', 10) || 200}px
                    </label>
                    <input type="range" min={40} max={500} step={10} value={parseInt(template.nlFooterLogoWidth || '0', 10) || 200} onChange={(e) => setT('nlFooterLogoWidth', e.target.value)} className="w-full" />
                  </div>
                </div>

                {/* Footer disclaimer */}
                <label className="mb-1 mt-4 block text-xs font-medium text-muted-foreground">Footer disclaimer</label>
                <textarea
                  value={template.nlFooterDisclaimer || ''}
                  onChange={(e) => setT('nlFooterDisclaimer', e.target.value)}
                  rows={3}
                  placeholder="If you follow a link in this email and make a purchase, we may earn a small commission…"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Delivery */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Delivery (Omniply)
            </h3>
            {!ghlConnected && (
              <p className="mb-3 text-xs text-amber-600">
                Connect Omniply in Settings to enable sending.
              </p>
            )}
            <div className="space-y-3">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">From name</label>
                  <input
                    value={delivery.newsletterFromName || ''}
                    onChange={(e) => setD('newsletterFromName', e.target.value)}
                    placeholder="Your practice name"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">From email</label>
                  <input
                    value={delivery.newsletterFromEmail || ''}
                    onChange={(e) => setD('newsletterFromEmail', e.target.value)}
                    placeholder="you@yourpractice.com"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Audience — sends to contacts with any of these tags
                </label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {audienceTags.map((t) => (
                    <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                      {t.name}
                      <button
                        onClick={() => setAudienceTags((prev) => prev.filter((x) => x.id !== t.id))}
                        className="text-muted-foreground hover:text-red-600"
                        title="Remove tag"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {audienceTags.length === 0 && <span className="text-xs text-amber-600">No audience tags — sending is disabled.</span>}
                </div>
                <div className="flex gap-2">
                  <select
                    value={addTagId}
                    onChange={(e) => setAddTagId(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Add a tag from your CRM…</option>
                    {locationTags
                      .filter((t) => !audienceTags.some((a) => a.id === t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                  <button
                    onClick={() => {
                      const t = locationTags.find((x) => x.id === addTagId)
                      if (t) setAudienceTags((prev) => [...prev, { id: t.id, name: t.name }])
                      setAddTagId('')
                    }}
                    disabled={!addTagId}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Send time</label>
                  <input
                    type="time"
                    value={delivery.newsletterSendTime || '09:00'}
                    onChange={(e) => setD('newsletterSendTime', e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Timezone</label>
                  <input
                    value={delivery.newsletterTimezone || 'America/New_York'}
                    onChange={(e) => setD('newsletterTimezone', e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="mx-auto w-full max-w-[680px] rounded-xl border border-border bg-card p-2">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs text-muted-foreground">Live preview (sample content)</span>
            <button
              onClick={() => refreshPreview(template)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>
          {previewHtml ? (
            <iframe
              title="Template preview"
              srcDoc={previewHtml}
              className="h-[760px] w-full rounded-lg border-0 bg-white"
            />
          ) : (
            <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
              <CheckCircle2 className="mr-2 h-4 w-4" /> Adjust settings, then Refresh.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
