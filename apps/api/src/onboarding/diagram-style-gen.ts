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
 * Failures retry 3x, then alert the admin immediately and leave the field
 * untouched → branded jewel guide fallback (Veit 2026-09-18).
 */
import { prisma, brandSettingsForUser, buildDiagramStyleGuide } from '@omniply/shared'
import { screenshotHomepage } from './site-analysis'
import { getSystemApiKey } from '../lib/system-keys'
import { logger } from '../lib/logger'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'
import { sendFailureAlert } from '../lib/alerts'

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

/**
 * House-signature connectors (Veit 2026-09-18, bench3-proven): the jewel
 * look's plasma currents, re-hued per brand, injected into EVERY generated
 * guide as a fixed block the vision model can't water down. This is the
 * product's recognizable thread across otherwise website-native styles.
 */
export function connectionsBlock(primary: string, light: string): string {
  return `## CONNECTIONS (house signature — this section wins over anything above)
- Connections between nodes are smooth, luminous gradient CURRENTS that flow
  from node to node — like gentle streams of light or energy. NEVER flat
  single-color lines, NEVER default arrows, NEVER plain thin strokes.
- Every current blends ${primary} → ${light} along its length, with a soft
  directional glow. Direction stays obvious: the current tapers or ends in an
  integrated arrowhead at its destination.
- On a LIGHT canvas the current is a SATURATED gradient ribbon of those two
  hues with a subtle halo of the same hue family — never pale, never grey,
  never washed out.
- On a DARK canvas the current glows softly against the background.`
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
- Do NOT define the connector/line treatment between nodes — connections are handled by a fixed house block appended separately. Your sections cover nodes, canvas, icons, and typography ONLY, and your ## PALETTE must NOT assign any hex to connector lines or arrows.
- ## PALETTE must use ONLY the brand hexes given above plus neutrals. Assign each hex to a VISUAL PART (e.g. "node borders", "node fills", "canvas") — never to labels, headings, or text roles, and never to connectors. End with: "These brand hues (plus neutrals) are the ENTIRE palette. Never render color names, hex codes, or role words as text in the image."
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
 * Retries the FULL attempt (screenshot → vision → validation) up to 3 times
 * (Veit 2026-09-18); on final failure it fires an admin failure alert
 * IMMEDIATELY (email via ALERT_EMAIL_TO + ErrorLog row — deliberately no
 * userId so the clinic is never emailed about an internal miss) and returns
 * null — the field stays untouched → branded jewel fallback.
 */
export async function generateDiagramStyleGuideFromWebsite(
  userId: string,
  opts: { screenshot?: Buffer } = {},
): Promise<StyleGuideGenResult | null> {
  const acct = await prisma.user
    .findUnique({ where: { id: userId }, select: { account: { select: { vertical: true } } } })
    .catch(() => null)
  if (acct?.account?.vertical === 'azavea') return null // locked design

  const brand = await brandSettingsForUser(userId).catch(() => null)
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

  const ATTEMPTS = 3
  let lastReason = 'unknown'
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // A caller-provided screenshot is only trusted on attempt 1 — retries recapture.
      const result = await attemptGeneration(userId, website, primary!, secondary!, geminiKey, attempt === 1 ? opts.screenshot : undefined)
      logger.info({ userId, attempt, chars: result.guide.length }, '[diagram-style-gen] website-derived guide stored')
      return result
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err)
      logger.warn({ userId, attempt, lastReason }, '[diagram-style-gen] attempt failed')
    }
  }

  // All attempts exhausted — alert Veit immediately; jewel fallback stays.
  await sendFailureAlert({
    errorType: 'diagram_style_generation_failed',
    message: `Website-derived diagram style guide failed after ${ATTEMPTS} attempts — the account keeps the default jewel style. Fix and use Settings → Diagram style → "Generate from my website" to retry.`,
    context: { userId, website, lastReason },
  }).catch((err) => logger.error({ userId, err }, '[diagram-style-gen] failure alert send failed'))
  return null
}

/** One full attempt: screenshot → vision → validate → assemble → store. Throws with a reason. */
async function attemptGeneration(
  userId: string,
  website: string,
  primary: string,
  secondary: string,
  geminiKey: string,
  providedScreenshot?: Buffer,
): Promise<StyleGuideGenResult> {
  {
    const shot = providedScreenshot ?? (await screenshotHomepage(website))
    if (!shot) throw new Error('screenshot failed')

    const palette = {
      primary,
      secondary,
      light: mixHex(primary, 0.45, 'w'),
      deep: mixHex(primary, 0.4, 'b'),
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
    if (invalid) throw new Error(`validation: ${invalid} (head: ${sections.slice(0, 80)})`)

    const guide = `# STYLE GUIDE\n\n${sections}\n\n${connectionsBlock(palette.primary, palette.light)}\n\n${FIXED_TAIL}`
    await prisma.brandSettings.updateMany({ where: { userId }, data: { diagramStyleGuide: guide } })
    return { guide, sections }
  }
}
