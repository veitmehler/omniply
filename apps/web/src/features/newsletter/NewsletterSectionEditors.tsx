'use client'

import { useRef, useState } from 'react'
import { Loader2, Pencil, Save, X, Bold, Italic, List } from 'lucide-react'

/** Section payload shapes (server-sanitized on save). */
interface ArticleSection {
  title?: string
  body?: string
  tldr?: string
}
interface Teaser {
  headline?: string | null
  title?: string
  body?: string
  cta?: string
}
interface QuickHits {
  tips?: string[]
  facts?: string[]
}
interface Fun {
  joke?: string | null
  triviaQuestion?: string | null
  triviaAnswer?: string | null
}
interface Recipe {
  title?: string | null
  intro?: string
  ingredients?: string
  instructions?: string
}
interface Modules {
  recipe?: Recipe | null
  recipe2?: Recipe | null
}

export interface EditableSections {
  featureArticle?: ArticleSection | null
  secondaryArticle?: ArticleSection | null
  teasers?: Teaser[] | null
  quickHits?: QuickHits | null
  fun?: Fun | null
  modules?: Modules | null
}

/** Minimal rich editor: contentEditable + bold/italic/list. The server
 *  sanitizes to an allowlist and the renderer restyles everything, so this
 *  never needs to produce perfect HTML — just the client's words. */
function RichArea({ initialHtml, onChange }: { initialHtml: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const cmd = (c: string) => {
    ref.current?.focus()
    document.execCommand(c)
    if (ref.current) onChange(ref.current.innerHTML)
  }
  return (
    <div>
      <div className="mb-1 flex gap-1">
        <button type="button" onClick={() => cmd('bold')} className="rounded border border-border p-1 hover:bg-muted" title="Bold"><Bold className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => cmd('italic')} className="rounded border border-border p-1 hover:bg-muted" title="Italic"><Italic className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => cmd('insertUnorderedList')} className="rounded border border-border p-1 hover:bg-muted" title="Bullet list"><List className="h-3.5 w-3.5" /></button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => ref.current && onChange(ref.current.innerHTML)}
        // Seeded once from the server-rendered section; edits stream via onInput.
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        className="min-h-[160px] max-h-[420px] overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  )
}

const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const areaCls = inputCls + ' resize-y'

/**
 * Per-section content editors (review UX plan feature 1): the client fixes
 * factually-wrong content in place; save PATCHes the section JSON and the
 * edition re-renders (Option B) so the preview updates immediately.
 */
export function NewsletterSectionEditors({
  sections,
  saving,
  onSave,
}: {
  sections: EditableSections
  saving: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})

  const start = (key: string, seed: unknown) => {
    setOpen(key)
    setDraft(JSON.parse(JSON.stringify(seed ?? {})))
  }
  const close = () => {
    setOpen(null)
    setDraft({})
  }
  const save = async (patch: Record<string, unknown>) => {
    await onSave(patch)
    close()
  }

  const rows: Array<{ key: string; label: string; present: boolean; seed: unknown }> = [
    { key: 'featureArticle', label: 'Feature article', present: !!sections.featureArticle, seed: sections.featureArticle },
    { key: 'secondaryArticle', label: 'Secondary article', present: !!sections.secondaryArticle, seed: sections.secondaryArticle },
    { key: 'teasers', label: 'Around-the-web teasers', present: (sections.teasers?.length ?? 0) > 0, seed: sections.teasers },
    { key: 'quickHits', label: 'Tips & facts', present: !!sections.quickHits, seed: sections.quickHits },
    { key: 'fun', label: 'Trivia & joke', present: !!sections.fun, seed: sections.fun },
    { key: 'modules', label: 'Recipes', present: !!(sections.modules?.recipe || sections.modules?.recipe2), seed: sections.modules },
  ]

  const d = draft as EditableSections[keyof EditableSections] & Record<string, unknown>

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit content</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Fix anything that&apos;s off — your changes re-render the preview instantly.
      </p>
      <div className="space-y-1.5">
        {rows.filter((r) => r.present).map((r) => (
          <div key={r.key}>
            <button
              onClick={() => (open === r.key ? close() : start(r.key, r.seed))}
              disabled={saving}
              className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
            >
              {r.label}
              {open === r.key ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>

            {open === r.key && (
              <div className="mt-2 space-y-3 rounded-lg border border-primary/40 bg-card p-3">
                {(r.key === 'featureArticle' || r.key === 'secondaryArticle') && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
                      <input value={(d.title as string) ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Article text</label>
                      <RichArea initialHtml={(r.seed as ArticleSection)?.body ?? ''} onChange={(html) => setDraft({ ...draft, body: html })} />
                    </div>
                    {typeof d.tldr === 'string' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">TL;DR</label>
                        <textarea value={d.tldr as string} onChange={(e) => setDraft({ ...draft, tldr: e.target.value })} rows={2} className={areaCls} />
                      </div>
                    )}
                  </>
                )}

                {r.key === 'teasers' &&
                  ((draft as unknown as Teaser[]) ?? []).map((t, i) => (
                    <div key={i} className="space-y-2 border-b border-border pb-3 last:border-0">
                      <label className="block text-xs font-medium text-muted-foreground">Teaser {i + 1} headline</label>
                      <input
                        value={t.headline ?? t.title ?? ''}
                        onChange={(e) => {
                          const arr = [...(draft as unknown as Teaser[])]
                          arr[i] = { ...arr[i], headline: e.target.value }
                          setDraft(arr as unknown as Record<string, unknown>)
                        }}
                        className={inputCls}
                      />
                      <label className="block text-xs font-medium text-muted-foreground">Teaser {i + 1} text</label>
                      <textarea
                        value={(t.body ?? '').replace(/<[^>]+>/g, '')}
                        onChange={(e) => {
                          const arr = [...(draft as unknown as Teaser[])]
                          arr[i] = { ...arr[i], body: `<p>${e.target.value}</p>` }
                          setDraft(arr as unknown as Record<string, unknown>)
                        }}
                        rows={3}
                        className={areaCls}
                      />
                    </div>
                  ))}

                {r.key === 'quickHits' && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Tips (one per line)</label>
                      <textarea
                        value={((d.tips as string[]) ?? []).join('\n')}
                        onChange={(e) => setDraft({ ...draft, tips: e.target.value.split('\n') })}
                        rows={4}
                        className={areaCls}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Facts (one per line)</label>
                      <textarea
                        value={((d.facts as string[]) ?? []).join('\n')}
                        onChange={(e) => setDraft({ ...draft, facts: e.target.value.split('\n') })}
                        rows={4}
                        className={areaCls}
                      />
                    </div>
                  </>
                )}

                {r.key === 'fun' && (
                  <>
                    {(['joke', 'triviaQuestion', 'triviaAnswer'] as const).map((k) => (
                      <div key={k}>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          {k === 'joke' ? 'Joke' : k === 'triviaQuestion' ? 'Trivia question' : 'Trivia answer'}
                        </label>
                        <textarea value={(d[k] as string) ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} rows={2} className={areaCls} />
                      </div>
                    ))}
                  </>
                )}

                {r.key === 'modules' &&
                  (['recipe', 'recipe2'] as const).map((rk) => {
                    const rec = (draft as Modules)[rk]
                    if (!rec) return null
                    const set = (field: keyof Recipe, v: string) =>
                      setDraft({ ...draft, [rk]: { ...rec, [field]: v } })
                    return (
                      <div key={rk} className="space-y-2 border-b border-border pb-3 last:border-0">
                        <div className="text-xs font-semibold">{rk === 'recipe' ? 'Recipe 1' : 'Recipe 2'}: {rec.title ?? ''}</div>
                        <label className="block text-xs font-medium text-muted-foreground">Ingredients</label>
                        <textarea value={rec.ingredients ?? ''} onChange={(e) => set('ingredients', e.target.value)} rows={5} className={areaCls} />
                        <label className="block text-xs font-medium text-muted-foreground">Instructions</label>
                        <textarea value={rec.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} rows={5} className={areaCls} />
                      </div>
                    )
                  })}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => save({ [r.key]: draft })}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save &amp; re-render
                  </button>
                  <button onClick={close} disabled={saving} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
