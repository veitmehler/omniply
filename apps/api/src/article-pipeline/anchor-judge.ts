/**
 * The judge behind citation placement (2026-11-24): does this article sentence
 * state this fact? Word matching proposes pairs (source-verify.ts); this
 * confirms them, because close wording can carry a different claim: a finding
 * in long-COVID patients against a sentence about concussion, or a definition
 * of a herniated disc against a sentence about pressure while sitting.
 */
import { getSystemApiKey } from '../lib/system-keys'
import { meteredCost } from './llm/metered-cost'
import type { AnchorJudge } from './source-verify'

const JUDGE_MODEL = process.env.ANCHOR_JUDGE_MODEL || 'gemini-3.1-flash-lite'
const BATCH = 30
const TIMEOUT_MS = 40_000

export function anchorJudgePrompt(pairs: Array<{ fact: string; sentence: string }>): string {
  return (
    `A citation link will be put on an article SENTENCE, pointing to the source of a FACT. For each numbered pair, decide whether the sentence states that fact.\n` +
    `"same" is true only when the sentence makes the same claim as the fact: about the same thing (the same condition, treatment, body part and group of people), in the same direction, and with the same figure where either gives one. The sentence may be shorter, plainer or reworded, and may add a remark of the author's.\n` +
    `"same" is false when the sentence is about a different condition, treatment or group even if the wording is close; when it only shares a topic with the fact; or when it states something the fact does not say.\n\n` +
    pairs.map((p, i) => `${i + 1}.\nFACT: ${p.fact}\nSENTENCE: ${p.sentence}`).join('\n\n') +
    `\n\nReturn ONLY a JSON array with one entry per pair, in order: [{"n": 1, "same": true|false}, ...]`
  )
}

export function parseAnchorVerdicts(raw: string, count: number): boolean[] | null {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return null
  try {
    const rows = JSON.parse(m[0]) as Array<{ n?: unknown; same?: unknown }>
    if (!Array.isArray(rows)) return null
    const out: boolean[] = []
    for (let i = 0; i < count; i++) {
      const row = rows.find((r) => Number(r?.n) === i + 1)
      if (!row) return null // an unanswered pair is a failed batch, never a silent "no" or "yes"
      out.push(row.same === true || String(row.same).toLowerCase() === 'true')
    }
    return out
  } catch {
    return null
  }
}

/** The live judge. `onCost` receives what each call cost so the caller can account for it. */
export function liveAnchorJudge(onCost?: (cost: number, tokens: { input: number; output: number }) => void): AnchorJudge {
  return async (pairs) => {
    const key = await getSystemApiKey('gemini')
    if (!key) throw new Error('No Gemini key')
    const out: boolean[] = []
    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH)
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: anchorJudgePrompt(batch) }] }], generationConfig: { maxOutputTokens: 1200, temperature: 0, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`Gemini ${res.status}`)
      const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number } }
      const input = j.usageMetadata?.promptTokenCount ?? 0
      const output = (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0)
      onCost?.(meteredCost('gemini', JUDGE_MODEL, input, output, 0, j.usageMetadata?.cachedContentTokenCount ?? 0), { input, output })
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
      const verdicts = parseAnchorVerdicts(text, batch.length)
      if (!verdicts) throw new Error('anchor judge output unparseable')
      out.push(...verdicts)
    }
    return out
  }
}
