'use client'

import { Save, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { SettingsData } from './useSettingsData'

// Standalone HTML article typography
export function ArticleTypographySection({ settings }: { settings: SettingsData }) {
  const {
    articleFontFamily, setArticleFontFamily,
    articleDisclaimer, setArticleDisclaimer,
    articleFontWeight, setArticleFontWeight,
    articleFontSizeBase, setArticleFontSizeBase,
    isSavingArticleFonts,
    handleSaveArticleTypography,
  } = settings
  const [regeneratingDisclaimer, setRegeneratingDisclaimer] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-card-foreground mb-2">Article typography (HTML export)</h2>
      <p className="text-sm text-muted-foreground mb-6">
        These settings apply to the downloadable standalone <code className="text-xs bg-muted px-1 rounded">article.html</code> export only.
        WordPress publishes use your theme&apos;s typography.
      </p>
      <div className="space-y-5 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">Font family</label>
          <input
            type="text"
            value={articleFontFamily}
            onChange={(e) => setArticleFontFamily(e.target.value)}
            placeholder='e.g. "Inter", system-ui, sans-serif'
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Quick picks:{' '}
            <button type="button" className="underline text-primary" onClick={() => setArticleFontFamily('Georgia, serif')}>
              Georgia
            </button>
            {' · '}
            <button type="button" className="underline text-primary" onClick={() => setArticleFontFamily('Inter, sans-serif')}>
              Inter
            </button>
            {' · '}
            <button type="button" className="underline text-primary" onClick={() => setArticleFontFamily('Merriweather, serif')}>
              Merriweather
            </button>
            {' · '}
            <button type="button" className="underline text-primary" onClick={() => setArticleFontFamily('Roboto, sans-serif')}>
              Roboto
            </button>
            {' · '}
            <button type="button" className="underline text-primary" onClick={() => setArticleFontFamily('"Open Sans", sans-serif')}>
              Open Sans
            </button>
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">Font weight (body)</label>
          <select
            value={articleFontWeight}
            onChange={(e) => setArticleFontWeight(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="400">400 — Normal</option>
            <option value="500">500 — Medium</option>
            <option value="600">600 — Semi-bold</option>
            <option value="700">700 — Bold</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">Base font size</label>
          <input
            type="text"
            value={articleFontSizeBase}
            onChange={(e) => setArticleFontSizeBase(e.target.value)}
            placeholder="16px"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">Use a CSS length (e.g. 16px, 1rem, 112.5%).</p>
        </div>
        {/* Article footer disclaimer — once per clinic, used verbatim on every
            article (Veit 2026-09-19). Generated + validated at onboarding;
            editable here; per-article LLM generation retired for clinics. */}
        <div className="border-t border-border pt-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-card-foreground">Article footer disclaimer</label>
            <button
              type="button"
              disabled={regeneratingDisclaimer}
              onClick={async () => {
                setRegeneratingDisclaimer(true)
                try {
                  const res = await fetch('/api/brand-settings/generate-article-disclaimer', { method: 'POST' })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok) {
                    toast.error(data.error ?? 'Disclaimer generation failed')
                    return
                  }
                  setArticleDisclaimer(data.disclaimer)
                  toast.success('Disclaimer regenerated — review below, then save.')
                } finally {
                  setRegeneratingDisclaimer(false)
                }
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              {regeneratingDisclaimer ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            Shown at the bottom of every published article. Edit freely — for example to match wording your
            legal counsel prefers.
          </p>
          <textarea
            value={articleDisclaimer}
            onChange={(e) => setArticleDisclaimer(e.target.value)}
            rows={7}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground"
          />
        </div>

        <Button onClick={() => void handleSaveArticleTypography()} disabled={isSavingArticleFonts}>
          {isSavingArticleFonts ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save article typography
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
