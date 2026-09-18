/**
 * Restyle fidelity verify pass (Veit 2026-09-18, from the 4-site bench):
 * the image model occasionally corrupts complex diagrams no matter how good
 * the style prompt is — bench showed label truncation and node duplication
 * concentrated on the hardest source diagram (14/16 first-try clean).
 *
 * After each AI restyle, a cheap vision call compares the restyled image's
 * TEXT content against the source render. Fail → caller retries once →
 * second fail → the diagram falls back to the plain Mermaid render.
 * A verify ERROR (API down / undecodable) accepts the restyle with a warn —
 * availability over strictness for infrastructure faults; the gate is for
 * model corruption, which returns a clean verdict either way.
 */
import sharp from 'sharp'
import { logger } from '../../lib/logger'
import { instrumentCall } from '../../lib/net/instrument'
import { withTimeout } from '../../lib/net/with-timeout'

export const VERIFY_MODEL = 'gemini-3-flash-preview'

export interface VerifyResult {
  verdict: 'pass' | 'fail' | 'error'
  issues: string[]
}

const VERIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['pass', 'fail'] },
    issues: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['verdict', 'issues'],
}

async function toCheckJpeg(png: Buffer): Promise<Buffer> {
  return sharp(png).resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
}

export async function verifyRestyledDiagram(opts: {
  geminiKey: string
  sourcePng: Buffer
  restyledPng: Buffer
  jobId?: string
}): Promise<VerifyResult> {
  try {
    const [srcJpg, outJpg] = await Promise.all([toCheckJpeg(opts.sourcePng), toCheckJpeg(opts.restyledPng)])

    const prompt = `Image A is the SOURCE diagram (ground truth). Image B is an artistic redesign of it.

Compare ONLY the TEXT content and node structure — visual styling, colors, icons, layout rearrangement, and letter case are all irrelevant and allowed.

Image B FAILS if ANY of these is true:
- a text label from A is missing or truncated in B (words dropped),
- a node/label appears MORE times in B than in A (duplicated into extra nodes),
- B contains invented text that is not in A (new labels, headings, category titles, color names, hex codes),
- a label's wording was changed beyond case/line-break differences.

Decorative icons without text are fine. Minor rendering artifacts in single characters are fine.

Respond with verdict "pass" or "fail" and list every concrete issue found (empty list when passing).`

    const text = await instrumentCall({ provider: 'gemini', op: 'diagram-verify' }, () =>
      withTimeout(
        async (signal) => {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${VERIFY_MODEL}:generateContent?key=${opts.geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { text: prompt },
                      { inlineData: { mimeType: 'image/jpeg', data: srcJpg.toString('base64') } },
                      { inlineData: { mimeType: 'image/jpeg', data: outJpg.toString('base64') } },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0,
                  responseMimeType: 'application/json',
                  responseSchema: VERIFY_SCHEMA,
                },
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
        },
        60_000,
        'diagram-verify',
      ),
    )

    const parsed = JSON.parse(text) as { verdict?: string; issues?: string[] }
    if (parsed.verdict === 'pass' || parsed.verdict === 'fail') {
      return { verdict: parsed.verdict, issues: parsed.issues ?? [] }
    }
    return { verdict: 'error', issues: [`unparseable verdict: ${text.slice(0, 120)}`] }
  } catch (err) {
    logger.warn({ jobId: opts.jobId, err }, '[diagram-verify] verify call failed — accepting restyle')
    return { verdict: 'error', issues: [err instanceof Error ? err.message : String(err)] }
  }
}
