/**
 * Fact correction that leaves the rest of the article alone (author-voice
 * plan, stage 2, section 7).
 *
 * The fact check lists claims with a verdict. Until now the correction step
 * gave the whole draft back to a model under the full rule set, so every
 * sentence could change. Here the claims that failed are located in the draft,
 * only those sentences are rewritten (by a step that has the author's words in
 * front of it), and code checks each rewrite before it goes in.
 */

export interface CheckedClaim {
  claim: string
  verdict: string
  explanation: string
  /** False when the fact check says the claim is wrong or only partly right. */
  ok: boolean
}

const unquote = (s: string) => s.trim().replace(/^["“”']+|["“”']+$/g, '').trim()

/** Read the fact check's list ("- Fact or Claim: … - Verdict: … - Explanation: …"). */
export function parseFactCheck(raw: string): CheckedClaim[] {
  const out: CheckedClaim[] = []
  const blocks = raw.split(/\n\s*(?:[-*•]\s*)?(?:\*\*)?Fact or Claim(?:\*\*)?\s*:\s*(?:\*\*)?/i).slice(1)
  for (const b of blocks) {
    const m = b.match(/^([\s\S]*?)\n\s*(?:[-*•]\s*)?(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?([\s\S]*?)(?:\n\s*(?:[-*•]\s*)?(?:\*\*)?Explanation(?:\*\*)?\s*:\s*(?:\*\*)?([\s\S]*))?$/i)
    if (!m) continue
    const claim = unquote(m[1].replace(/\s+/g, ' '))
    const verdict = unquote(m[2].replace(/\s+/g, ' '))
    const explanation = (m[3] ?? '').replace(/\s+/g, ' ').trim()
    if (!claim) continue
    const bad = /\b(partly|partially|false|untrue|incorrect|inaccurate|misleading|not (true|accurate|supported|valid)|unsupported|unverified|overstated|exaggerated)\b/i.test(verdict)
    out.push({ claim, verdict, explanation, ok: !bad })
  }
  return out
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[*_`]+/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The sentences of a markdown draft, each with its place, headings and list markers left out. */
export function draftSentences(md: string): Array<{ text: string; from: number; to: number }> {
  const out: Array<{ text: string; from: number; to: number }> = []
  let offset = 0
  for (const line of md.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    if (!line.trim() || /^\s*#{1,6}\s/.test(line)) continue
    const lead = line.match(/^\s*(?:[-*+]|\d+[.)])\s+/)?.[0].length ?? line.match(/^\s*/)![0].length
    const body = line.slice(lead)
    const re = /[^.!?…]+(?:[.!?…]+["”’)\]*_]*|$)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const text = m[0]
      if (!/[A-Za-z]{2}/.test(text)) continue
      const startTrim = text.length - text.trimStart().length
      out.push({ text: text.trim(), from: lineStart + lead + m.index + startTrim, to: lineStart + lead + m.index + text.trimEnd().length })
    }
  }
  return out
}

/** The sentence of the draft a checked claim refers to: an exact quote where possible, else the closest by shared words. */
export function locateClaim(md: string, claim: string): { text: string; from: number; to: number } | null {
  const sentences = draftSentences(md)
  const want = norm(claim)
  if (want.split(' ').length < 3) return null
  const exact = sentences.find((s) => norm(s.text) === want) ?? sentences.find((s) => norm(s.text).includes(want)) ?? sentences.find((s) => want.includes(norm(s.text)) && norm(s.text).split(' ').length >= 6)
  if (exact) return exact
  const w = new Set(want.split(' ').filter((x) => x.length > 3))
  let best: { s: (typeof sentences)[number]; score: number } | null = null
  for (const s of sentences) {
    const sw = new Set(norm(s.text).split(' ').filter((x) => x.length > 3))
    if (!sw.size || !w.size) continue
    let n = 0
    for (const x of w) if (sw.has(x)) n++
    const score = n / Math.max(w.size, sw.size)
    if (!best || score > best.score) best = { s, score }
  }
  return best && best.score >= 0.7 ? best.s : null
}

const numbers = (s: string): Set<string> => new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')))
const STRENGTHEN_RE = /\b(guarantee[sd]?|cure[sd]?|always works|proven|will fix|definitely|certainly will|100%)\b/i
export const DELETE = '[DELETE]'

/**
 * May this rewrite replace the sentence? A corrected figure has to come from the
 * fact check's own explanation; nothing else new may appear.
 */
export function fixAcceptable(original: string, rewrite: string, explanation: string): boolean {
  const r = rewrite.trim()
  if (r === DELETE) return true
  if (!r || /https?:\/\/|\]\(|<a\s/i.test(r)) return false
  const allowed = new Set([...numbers(original), ...numbers(explanation)])
  for (const n of numbers(r)) if (!allowed.has(n)) return false
  if (STRENGTHEN_RE.test(r) && !STRENGTHEN_RE.test(original)) return false
  const words = (s: string) => s.trim().split(/\s+/).length
  if (words(r) > words(original) * 1.6 + 12) return false
  // The fix must not bring the fact check into the article.
  if (/\b(fact[- ]check|verified fact|according to the source|the source (says|states))\b/i.test(r)) return false
  return true
}

export interface FixRequest {
  id: number
  sentence: string
  /** The paragraph the sentence sits in, for context. */
  paragraph: string
  problem: string
  from: number
  to: number
}

/** The failed claims that can be found in the draft, one request per sentence. */
export function fixRequests(md: string, claims: CheckedClaim[]): { requests: FixRequest[]; notFound: CheckedClaim[] } {
  const requests: FixRequest[] = []
  const notFound: CheckedClaim[] = []
  for (const c of claims.filter((x) => !x.ok)) {
    const at = locateClaim(md, c.claim)
    if (!at) {
      notFound.push(c)
      continue
    }
    const existing = requests.find((r) => r.from === at.from)
    if (existing) {
      existing.problem += ` Also: ${c.verdict}. ${c.explanation}`
      continue
    }
    const paraStart = md.lastIndexOf('\n\n', at.from) + 1
    const paraEnd = md.indexOf('\n\n', at.to)
    requests.push({ id: requests.length + 1, sentence: at.text, paragraph: md.slice(Math.max(0, paraStart), paraEnd === -1 ? md.length : paraEnd).trim(), problem: `${c.verdict}. ${c.explanation}`.trim(), from: at.from, to: at.to })
  }
  return { requests, notFound }
}

export function parseFixes(raw: string): Map<number, string> {
  const out = new Map<number, string>()
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { fixes?: unknown }
    for (const f of Array.isArray(j.fixes) ? (j.fixes as Array<Record<string, unknown>>) : []) {
      const id = Number(f.id)
      const rewrite = String(f.rewrite ?? '').trim()
      if (Number.isInteger(id) && rewrite) out.set(id, rewrite)
    }
  } catch {
    /* no fixes */
  }
  return out
}

/** Put the accepted rewrites into the draft. Later places first, so earlier offsets stay valid. */
export function applyFixes(md: string, requests: FixRequest[], fixes: Map<number, string>): { text: string; applied: number; deleted: number; refused: number } {
  let text = md
  let applied = 0
  let deleted = 0
  let refused = 0
  for (const r of [...requests].sort((a, b) => b.from - a.from)) {
    const rewrite = fixes.get(r.id)
    if (rewrite === undefined) continue
    if (!fixAcceptable(r.sentence, rewrite, r.problem)) {
      refused++
      continue
    }
    if (rewrite.trim() === DELETE) {
      text = (text.slice(0, r.from) + text.slice(r.to)).replace(/ {2,}/g, ' ')
      deleted++
    } else {
      text = text.slice(0, r.from) + rewrite.trim() + text.slice(r.to)
      applied++
    }
  }
  return { text: text.replace(/\n{3,}/g, '\n\n'), applied, deleted, refused }
}
