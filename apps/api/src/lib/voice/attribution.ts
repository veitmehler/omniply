/**
 * Attribution judge (author-voice plan, stage 0, 2026-11-26).
 *
 * The acceptance test for "written as the author": a judge is shown real
 * samples from several writers and one text with no byline, and has to say who
 * wrote it. If an article written for one author could as well be another's,
 * the voice is not there.
 *
 * Names, clinics and places are masked first, so the judge cannot read the
 * answer off the page. The judge is told to go by manner, never by topic, and
 * may answer that none of the candidates fits. Each text is judged several
 * times with the candidates in a different order and with different samples,
 * because a single line-up can be won on position alone.
 */

export interface LineupCandidate {
  /** Stable id of the writer, never shown to the judge. */
  id: string
  /** Several excerpts of their real writing; each vote draws from them. */
  samples: string[]
}

/** Replace anything that names a person, a business or a place. Longest terms first so "Coast Chiropractic Kawana" goes before "Kawana". */
export function maskIdentity(text: string, terms: string[]): string {
  let out = text
  for (const t of [...new Set(terms.filter((x) => x.trim().length >= 3))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|\u2019s)?\\b`, 'gi'), '[name]')
  }
  return out.replace(/(?:\[name\][\s,]*){2,}/g, '[name] ')
}

/** Small seeded generator so a bench run can be repeated exactly. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LABELS = 'ABCDEFGHIJKL'.split('')

export function lineupPrompt(candidates: Array<{ label: string; sample: string }>, text: string): string {
  return (
    `You compare writing styles. Below are samples from ${candidates.length} different writers, then one TEXT whose author is unknown. Decide which writer, if any, wrote the TEXT.\n\n` +
    `Judge by MANNER only: sentence length and rhythm, how a point is opened and closed, how the writer addresses the reader, humour, the kind of images and comparisons used, favourite small words, punctuation habits, how sure or tentative they sound.\n` +
    `Ignore the TOPIC, the field, the facts, the layout and the headings. Two writers can share a subject and a subject says nothing about who wrote it. Names and places have been replaced by [name].\n` +
    `The TEXT may be by none of them. Say so when no candidate's manner is clearly there.\n\n` +
    candidates.map((c) => `=== WRITER ${c.label} ===\n${c.sample}`).join('\n\n') +
    `\n\n=== TEXT ===\n${text}\n\n` +
    `Return ONLY this JSON object:\n` +
    `{"ranking": [<all writer labels, most likely first>], "none_fits": <true|false>, "confidence": <0 to 1, how sure you are of the first place>, "evidence": "<at most 40 words: the habits in the TEXT that decided it>"}`
  )
}

export interface Verdict {
  ranking: string[]
  noneFits: boolean
  confidence: number
  evidence: string
}

export function parseVerdict(raw: string, labels: string[]): Verdict | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { ranking?: unknown; none_fits?: unknown; confidence?: unknown; evidence?: unknown }
    if (!Array.isArray(j.ranking)) return null
    const ranking = j.ranking.map((x) => String(x).replace(/^writer\s*/i, '').trim().toUpperCase()).filter((x) => labels.includes(x))
    if (new Set(ranking).size === 0) return null
    // Anything the judge left out goes to the end, so every candidate has a place.
    for (const l of labels) if (!ranking.includes(l)) ranking.push(l)
    const c = Number(j.confidence)
    return { ranking: [...new Set(ranking)], noneFits: j.none_fits === true || String(j.none_fits).toLowerCase() === 'true', confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0, evidence: String(j.evidence ?? '').slice(0, 300) }
  } catch {
    return null
  }
}

export interface AttributionResult {
  /** The writer placed first most often; ties go to the better average place. */
  winner: string
  /** How many votes put each writer first. */
  firstPlaces: Record<string, number>
  /** Average place of each writer over the votes (1 = always first). */
  meanPlace: Record<string, number>
  /** Votes in which the judge said no candidate fits. */
  noneFits: number
  votes: number
  evidence: string[]
}

export async function attribute(opts: {
  text: string
  candidates: LineupCandidate[]
  call: (prompt: string) => Promise<string>
  votes?: number
  seed?: number
  /** Words of sample shown per writer. */
  sampleWords?: number
}): Promise<AttributionResult> {
  const rand = seeded(opts.seed ?? 1)
  const votes = opts.votes ?? 3
  const first: Record<string, number> = {}
  const places: Record<string, number[]> = {}
  for (const c of opts.candidates) {
    first[c.id] = 0
    places[c.id] = []
  }
  let noneFits = 0
  let counted = 0
  const evidence: string[] = []
  for (let v = 0; v < votes; v++) {
    const order = [...opts.candidates].sort(() => rand() - 0.5)
    const labelled = order.map((c, i) => ({ id: c.id, label: LABELS[i], sample: pickSample(c.samples, opts.sampleWords ?? 550, rand) }))
    const verdict = parseVerdict(await opts.call(lineupPrompt(labelled, opts.text)), labelled.map((l) => l.label))
    if (!verdict) continue
    counted++
    if (verdict.noneFits) noneFits++
    verdict.ranking.forEach((label, place) => {
      const id = labelled.find((l) => l.label === label)!.id
      places[id].push(place + 1)
      if (place === 0) first[id]++
    })
    if (verdict.evidence) evidence.push(verdict.evidence)
  }
  const meanPlace: Record<string, number> = {}
  for (const [id, ps] of Object.entries(places)) meanPlace[id] = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : opts.candidates.length
  const winner = Object.keys(first).sort((a, b) => first[b] - first[a] || meanPlace[a] - meanPlace[b])[0]
  return { winner, firstPlaces: first, meanPlace, noneFits, votes: counted, evidence }
}

/** Join a few of the writer's excerpts, starting somewhere different each time, up to about `words` words. */
export function pickSample(samples: string[], words: number, rand: () => number): string {
  if (samples.length === 0) return ''
  const start = Math.floor(rand() * samples.length)
  const parts: string[] = []
  let n = 0
  for (let i = 0; i < samples.length && n < words; i++) {
    const s = samples[(start + i * 2 + (i % 2)) % samples.length]
    if (parts.includes(s)) continue
    const w = s.split(/\s+/)
    const take = w.slice(0, Math.min(w.length, Math.max(120, Math.ceil(words / 3))))
    parts.push(take.join(' '))
    n += take.length
  }
  return parts.join('\n[...]\n')
}
