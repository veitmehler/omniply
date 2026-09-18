'use client'

import { useState } from 'react'
import { Save, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { SettingsData } from './useSettingsData'

// Mermaid diagram styling (article enrichment)
export function DiagramStyleSection({ settings }: { settings: SettingsData }) {
  const [generating, setGenerating] = useState(false)
  const {
    diagramPrimaryColor, setDiagramPrimaryColor,
    diagramSecondaryColor, setDiagramSecondaryColor,
    diagramLineColor, setDiagramLineColor,
    diagramFontFamily, setDiagramFontFamily,
    diagramStyleGuide, setDiagramStyleGuide,
    diagramStyleGuideDefault,
    diagramLogoVariant, setDiagramLogoVariant,
    isSavingDiagramStyle,
    handleSaveDiagramStyle,
  } = settings

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-card-foreground mb-2">Diagram style</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Node and line colors for Mermaid diagrams during article enrichment; label text contrast is chosen
        automatically by the renderer. Leave blank to use built-in defaults (blue / violet / gray).
        Secondary color is also used as the tertiary accent for a two-tone look.
      </p>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Primary (node fill)</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={diagramPrimaryColor || '#3B82F6'}
                onChange={(e) => setDiagramPrimaryColor(e.target.value.toUpperCase())}
                className="h-10 w-14 cursor-pointer rounded border border-input bg-background p-1"
                aria-label="Primary diagram color"
              />
              <input
                type="text"
                value={diagramPrimaryColor}
                onChange={(e) => setDiagramPrimaryColor(e.target.value)}
                placeholder="#3B82F6"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Secondary (accent)</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={diagramSecondaryColor || '#8B5CF6'}
                onChange={(e) => setDiagramSecondaryColor(e.target.value.toUpperCase())}
                className="h-10 w-14 cursor-pointer rounded border border-input bg-background p-1"
                aria-label="Secondary diagram color"
              />
              <input
                type="text"
                value={diagramSecondaryColor}
                onChange={(e) => setDiagramSecondaryColor(e.target.value)}
                placeholder="#8B5CF6"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">Connector lines</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={diagramLineColor || '#6B7280'}
                onChange={(e) => setDiagramLineColor(e.target.value.toUpperCase())}
                className="h-10 w-14 cursor-pointer rounded border border-input bg-background p-1"
                aria-label="Line color"
              />
              <input
                type="text"
                value={diagramLineColor}
                onChange={(e) => setDiagramLineColor(e.target.value)}
                placeholder="#6B7280"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">Font family</label>
          <select
            value={diagramFontFamily}
            onChange={(e) => setDiagramFontFamily(e.target.value)}
            className="w-full max-w-lg rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">Server default</option>
            <option value="Arial, Helvetica, sans-serif">Arial, Helvetica, sans-serif</option>
            <option value="Georgia, serif">Georgia, serif</option>
            <option value="Inter, sans-serif">Inter, sans-serif</option>
            <option value="Roboto, sans-serif">Roboto, sans-serif</option>
            <option value="Open Sans, sans-serif">&quot;Open Sans&quot;, sans-serif</option>
            <option value="Lato, sans-serif">Lato, sans-serif</option>
            <option value="Source Sans 3, sans-serif">&quot;Source Sans 3&quot;, sans-serif</option>
            <option value="Nunito, sans-serif">Nunito, sans-serif</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Choose &quot;Server default&quot; to use the built-in font.
          </p>
        </div>

        {/* AI restyle — Nano Banana style guide */}
        <div className="border-t border-border pt-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-card-foreground">AI diagram style guide</label>
            <span className="flex items-center gap-3">
              <button
                type="button"
                disabled={generating}
                onClick={async () => {
                  setGenerating(true)
                  try {
                    const res = await fetch('/api/brand-settings/generate-diagram-style', { method: 'POST' })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      toast.error(data.error ?? 'Style generation failed')
                      return
                    }
                    setDiagramStyleGuide(data.guide)
                    toast.success('Style derived from your website — review below, then save.')
                  } finally {
                    setGenerating(false)
                  }
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                {generating ? 'Reading your website…' : 'Generate from my website'}
              </button>
              {diagramStyleGuideDefault && diagramStyleGuide.trim() !== diagramStyleGuideDefault.trim() && (
                <button
                  type="button"
                  onClick={() => setDiagramStyleGuide(diagramStyleGuideDefault)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Reset to default
                </button>
              )}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            After each diagram is generated, it&apos;s redesigned into a polished, on-brand image for your
            industry. This style guide controls that look — edit it to match your brand. Leave it as the
            default to use our recommended style.
          </p>
          <textarea
            value={diagramStyleGuide}
            onChange={(e) => setDiagramStyleGuide(e.target.value)}
            rows={16}
            spellCheck={false}
            placeholder={diagramStyleGuideDefault}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground"
          />

          {/* Watermark logo variant */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-card-foreground mb-1">Watermark logo</label>
            <select
              value={diagramLogoVariant}
              onChange={(e) => setDiagramLogoVariant(e.target.value)}
              className="w-full max-w-lg rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="light">Light — for dark diagram backgrounds</option>
              <option value="dark">Dark — for light diagram backgrounds</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Your logo is overlaid (semi-transparent, bottom-right) on each diagram. Pick the variant that
              contrasts with the background your style guide produces. Light/dark variants are generated
              automatically from your logo.
            </p>
          </div>
        </div>

        <Button onClick={handleSaveDiagramStyle} disabled={isSavingDiagramStyle}>
          {isSavingDiagramStyle ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save diagram style
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
