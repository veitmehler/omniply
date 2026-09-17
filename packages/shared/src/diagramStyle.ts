/**
 * AI diagram restyle ("Nano Banana") — style guide.
 *
 * The signature aesthetic (jewel-box capsules, plasma currents, deep-ink
 * background) is constant; the PALETTE is a parameter. `buildDiagramStyleGuide`
 * bakes the brand's diagram colors directly into the palette section — an
 * appended "override" paragraph proved too weak: the model kept following the
 * default gold/violet vocabulary it was fighting (Veit finding 2026-09-17,
 * "Great Indoors Migration" diagrams came out gold+purple despite the
 * override). Now there is exactly ONE set of color instructions in the prompt.
 *
 * `DEFAULT_DIAGRAM_STYLE_GUIDE` (the gold/violet look) remains the settings-page
 * prefill and the fallback for brands with no extracted colors. A business may
 * override everything via BrandSettings.diagramStyleGuide.
 *
 * Dep-free on purpose so it is safe to import from server routes (it travels to
 * the client as plain JSON via /api/brand-settings, never bundled directly).
 */

const GUIDE_HEX_RE = /^#?[0-9a-f]{6}$/i

function normHex(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!GUIDE_HEX_RE.test(t)) return null
  return (t.startsWith('#') ? t : `#${t}`).toUpperCase()
}

/** Mix a hex color toward white (amt 0..1) — for the light gradient endpoint. */
function lightenHex(hex: string, amt: number): string {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16)
    return Math.round(v + (255 - v) * amt)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${ch(1)}${ch(3)}${ch(5)}`.toUpperCase()
}

function guideBody(frameMaterial: string, paletteLines: string): string {
  return `# STYLE GUIDE

## CORE AESTHETIC
A premium, editorial "data-visualization" look — think a high-end science magazine
infographic. Two signature motifs define it:
- **Jewel-Box Data Capsules:** each node is a translucent, glass-like capsule — a
  softly-lit rounded container with subtle depth and a faint inner glow, as if the
  data is held inside a polished gem. Frames are thin and refined (${frameMaterial}),
  never heavy.
- **Plasma-Current Power Flows:** connections are smooth, luminous gradient
  currents that flow between capsules — like gentle light streams or energy, with
  soft directional glow, never flat arrows or hard lines.

Keep it sophisticated, calm, and professional. NOT cartoonish, NOT clip-art,
NOT neon/gamer, NOT childish.

## PALETTE
${paletteLines}
- Text is crisp and high-contrast against its capsule (light text on dark fills,
  dark text on light fills). Every label must remain perfectly legible.

## ICONOGRAPHY & ILLUSTRATION
"Line-Art Meets Anatomy": refined, thin-stroke line illustrations with a tasteful
medical/scientific sensibility appropriate to the audience (anatomical motifs,
molecular/orbital models, clean schematic icons). Minimal, elegant, consistent
stroke weight. No mascots, no emoji, no cartoon faces.

## STRUCTURAL ELEMENTS
- Nodes → translucent jewel-box capsules with thin frames and soft
  depth/shadow; content sits clearly inside.
- Connections → luminous gradient "plasma" currents with soft glow and clear
  direction; spacing is generous and the composition breathes.
- Preserve the informational structure exactly: keep EVERY node, EVERY label, and
  EVERY connection, and the direction of every arrow / the overall flow. Do not
  add, remove, rename, or merge anything; reproduce all text verbatim and keep it
  legible. You MAY re-arrange the spatial placement of nodes (e.g. reflow a long
  chain into a balanced grid or radial layout) to make full use of the square.

## CRUCIAL EXCLUSIONS
- **NO GLOBAL BLACK BORDER.** The entire composition must be borderless, or
  defined only by the internal data capsules and the deep background.
  ✓ Correct: capsules + currents float on the deep background, edge-to-edge.
  ✗ Wrong: a hard black rectangle/frame around the whole image.
- No watermarks, no logos, no signatures (branding is added separately).
- No global hard outline, no harsh drop-shadow box, no flat default arrows.`
}

export const DEFAULT_DIAGRAM_STYLE_GUIDE = guideBody(
  'brushed warm metal / soft gold',
  `- **Deep Ink** background: a rich, dark, near-charcoal navy that makes the
  capsules and currents glow.
- **Glacier Glass:** cool translucent whites/light-blues for capsule fills.
- **Warm Gold / Brushed Bronze:** for thin frames, accents, and key emphasis.
- **Plasma Teal & Soft Violet:** for the flowing current gradients.`,
)

/**
 * The brand-palette style guide: same signature aesthetic, but every color
 * instruction derives from the brand's diagram colors. Falls back to the
 * default (gold/violet) guide when no valid primary color is available.
 */
export function buildDiagramStyleGuide(
  primaryColor?: string | null,
  secondaryColor?: string | null,
): string {
  const primary = normHex(primaryColor)
  if (!primary) return DEFAULT_DIAGRAM_STYLE_GUIDE
  const secondary = normHex(secondaryColor) ?? primary
  const lightTint = lightenHex(primary, 0.45)

  return guideBody(
    `brushed metal tinted in the brand accent ${secondary}`,
    `- **Deep Ink** background: a rich, dark, near-charcoal navy that makes the
  capsules and currents glow.
- **Glacier Glass:** cool translucent whites and light tints of ${lightTint} for
  capsule fills.
- **Brand Accent ${secondary}:** for thin frames, accents, and key emphasis.
- **Brand Currents ${primary} → ${lightTint}:** the flowing current gradients
  blend between these two brand hues.
- These brand hues (plus neutrals) are the ENTIRE palette. Absolutely NO gold,
  NO bronze, NO amber, NO violet, NO purple anywhere in the composition.`,
  )
}
