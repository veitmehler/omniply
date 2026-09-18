/**
 * Website-derived diagram style guides (Veit 2026-09-17/18, pre-launch):
 * screenshot the clinic's homepage, have a vision model write the AESTHETIC
 * sections of a diagram style guide that matches the site, and store the
 * assembled guide in BrandSettings.diagramStyleGuide (which the restyle
 * prompt already honors verbatim, and the settings page already edits).
 *
 * The vision prompt is the bench-proven "round 3 + production rules" recipe
 * (.plans/website-diagram-styles.implementation-plan.md): few-shot example,
 * renderer named WITH behavioral profile, treatment-only rule, palette
 * assigned to visual parts, mandatory border commitment, fill discipline.
 * Guardrail sections (STRUCTURAL ELEMENTS / CRUCIAL EXCLUSIONS) are NEVER
 * LLM-authored — they are the fixed tail below.
 *
 * Any failure (no website, screenshot, vision, validation) → returns null
 * and leaves the field untouched → branded jewel guide fallback.
 */
import { prisma, brandSettingsForUser, buildDiagramStyleGuide } from '@omniply/shared'
import { screenshotHomepage } from './site-analysis'
import { getSystemApiKey } from '../lib/system-keys'
import { logger } from '../lib/logger'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'

export const STYLE_GUIDE_VISION_MODEL = 'gemini-3-flash-preview'

/** Mix a hex toward white ('w') or black ('b'). */
function mixHex(hex: string, amt: number, to: 'w' | 'b'): string {
  const t = to === 'w' ? 255 : 0
  const ch = (i: number) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amt) + t * amt)
      .toString(16)
      .padStart(2, '0')
  return `#${ch(1)}${ch(3)}${ch(5)}`.toUpperCase()
}

const FIXED_TAIL = `## STRUCTURAL ELEMENTS
- Preserve the informational structure exactly: keep EVERY node, EVERY label, and
  EVERY connection, and the direction of every arrow / the overall flow. Do not
  add, remove, rename, or merge anything; reproduce all text verbatim and keep it
  legible. You MAY re-arrange the spatial placement of nodes (e.g. reflow a long
  chain into a balanced grid or radial layout) to make full use of the square.
- SET CONSISTENCY: this diagram is one of a series in the same article. Apply the
  node treatment defined above IDENTICALLY — never mix outlined and borderless
  nodes within the series.

## CRUCIAL EXCLUSIONS
- **NO GLOBAL BLACK BORDER.** The entire composition must be borderless.
- No watermarks, no logos, no signatures (branding is added separately).
- No global hard outline, no harsh drop-shadow box, no flat default arrows.
- Every text label must remain perfectly legible and high-contrast.`

export function buildStyleGuideVisionPrompt(palette: {
  primary: string
  secondary: string
  light: string
  deep: string
}): string {
  const example = buildDiagramStyleGuide('#3aa6b9', '#2d808e')
    .split('## STRUCTURAL ELEMENTS')[0]
    .replace('# STYLE GUIDE', '')
    .trim()
  const PALETTE = `primary ${palette.primary}, secondary ${palette.secondary}, light tint ${palette.light}, deep tone ${palette.deep}`

  return `You are an art director writing instructions for Google's gemini-3.1-flash-image model ("Nano Banana"), which will redesign informational flow diagrams image-to-image. Know your reader: it is EXTREMELY literal — anything phrased like content gets drawn as content. It will render color names, hex codes, and role words as visible text inside the diagram if your wording allows it, so describe colors as materials applied to visual parts (borders, fills, connector lines, backgrounds), NEVER as roles attached to "labels" or "headings".

This is the homepage of a chiropractic / health clinic. Its brand palette (authoritative, extracted separately) is: ${PALETTE}.

Here is our house example of the first three sections of such a style guide — study its RIGOR: concrete named motifs, dense visual vocabulary an image model can execute, and one crucial discipline — it ONLY describes how to TREAT the diagram's existing nodes, connections, and labels. It never invites adding new structural elements (no category headers, no extra panels, no decorative chrome, no new text).

=== EXAMPLE (a different aesthetic — do NOT copy its look) ===
${example}
=== END EXAMPLE ===

Now study THIS website's visual CHARACTER — minimal or rich, warm or clinical, organic or geometric, flat or dimensional — and write the same three sections (## CORE AESTHETIC, ## PALETTE, ## ICONOGRAPHY & ILLUSTRATION) with the SAME rigor and discipline, but with an aesthetic derived from this website instead.

Hard rules:
- Like the example, describe ONLY the treatment of existing nodes, connections, and labels ("each node is…", "connections are…"). NEVER instruct the model to add headers, titles, categories, panels, or any text/structure that is not already in the diagram.
- BORDER COMMITMENT (mandatory): state EXPLICITLY whether nodes are borderless cards or outlined boxes — choose exactly ONE treatment; every diagram in the series will use it identically.
- The aesthetic must support filling the square canvas edge-to-edge with large, legible elements. Never prescribe "spaciousness", "generous whitespace", or empty margins — density and fill are handled elsewhere.
- ## PALETTE must use ONLY the brand hexes given above plus neutrals. Assign each hex to a VISUAL PART (e.g. "node borders", "connector lines", "canvas") — never to labels, headings, or text roles. End with: "These brand hues (plus neutrals) are the ENTIRE palette. Never render color names, hex codes, or role words as text in the image."
- No mascots, no emoji, no cartoon faces. Sophisticated and professional, NOT cartoonish.
- Output ONLY the three markdown sections, no preamble, no code fences. Under 320 words.`
}

/** Validation gate: refuse anything that would degrade the restyle prompt. */
export function validateGuideSections(
  sections: string,
  palette: { primary: string; secondary: string },
): string | null {
  const s = sections.trim()
  if (s.length < 300 || s.length > 3500) return `bad length ${s.length}`
  for (const h of ['## CORE AESTHETIC', '## PALETTE', '## ICONOGRAPHY & ILLUSTRATION']) {
    if (!s.includes(h)) return `missing section ${h}`
  }
  const up = s.toUpperCase()
  if (!up.includes(palette.primary.toUpperCase())) return 'primary hex missing'
  if (!up.includes(palette.secondary.toUpperCase())) return 'secondary hex missing'
  if (!/borderless|outlined/i.test(s)) return 'no border commitment'
  if (!s.includes('These brand hues (plus neutrals) are the ENTIRE palette')) return 'missing palette closer'
  if (s.includes('```')) return 'contains code fences'
  return null
}

export interface StyleGuideGenResult {
  guide: string
  sections: string
}

/**
 * Generate + validate + STORE the website-derived guide for a user.
 * Returns null (and logs why) on any failure — field stays untouched.
 */
export async function generateDiagramStyleGuideFromWebsite(
  userId: string,
  opts: { screenshot?: Buffer } = {},
): Promise<StyleGuideGenResult | null> {
  try {
    const acct = await prisma.user.findUnique({
      where: { id: userId },
      select: { account: { select: { vertical: true } } },
    })
    if (acct?.account?.vertical === 'azavea') return null // locked design

    const brand = await brandSettingsForUser(userId)
    const website = brand?.organizationWebsite?.trim()
    const primary = brand?.diagramPrimaryColor?.trim()?.toUpperCase()
    const secondary = brand?.diagramSecondaryColor?.trim()?.toUpperCase()
    if (!website || !/^#[0-9A-F]{6}$/.test(primary ?? '') || !/^#[0-9A-F]{6}$/.test(secondary ?? '')) {
      logger.info({ userId, website: !!website }, '[diagram-style-gen] missing website or diagram colors — skip')
      return null
    }

    const geminiKey = await getSystemApiKey('gemini')
    if (!geminiKey) {
      logger.warn({ userId }, '[diagram-style-gen] no gemini key — skip')
      return null
    }

    const shot = opts.screenshot ?? (await screenshotHomepage(website)) ?? (await screenshotHomepage(website))
    if (!shot) {
      logger.warn({ userId, website }, '[diagram-style-gen] screenshot failed — skip')
      return null
    }

    const palette = {
      primary: primary!,
      secondary: secondary!,
      light: mixHex(primary!, 0.45, 'w'),
      deep: mixHex(primary!, 0.4, 'b'),
    }
    const prompt = buildStyleGuideVisionPrompt(palette)

    const sections = await instrumentCall({ provider: 'gemini', op: 'diagram-style-gen' }, () =>
      withTimeout(
        async (signal) => {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${STYLE_GUIDE_VISION_MODEL}:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { text: prompt },
                      { inlineData: { mimeType: 'image/png', data: shot.toString('base64') } },
                    ],
                  },
                ],
                generationConfig: { temperature: 0.4 },
              }),
              signal,
            },
          )
          if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
          const data = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
          }
          return (data.candidates?.[0]?.content?.parts ?? [])
            .filter((p) => !p.thought)
            .map((p) => p.text ?? '')
            .join('')
            .trim()
        },
        90_000,
        'diagram-style-gen',
      ),
    )

    const invalid = validateGuideSections(sections, palette)
    if (invalid) {
      logger.warn({ userId, invalid, head: sections.slice(0, 120) }, '[diagram-style-gen] validation failed — jewel fallback stays')
      return null
    }

    const guide = `# STYLE GUIDE\n\n${sections}\n\n${FIXED_TAIL}`
    await prisma.brandSettings.updateMany({ where: { userId }, data: { diagramStyleGuide: guide } })
    logger.info({ userId, chars: guide.length }, '[diagram-style-gen] website-derived guide stored')
    return { guide, sections }
  } catch (err) {
    logger.warn({ userId, err }, '[diagram-style-gen] failed — jewel fallback stays')
    return null
  }
}
