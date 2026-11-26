/**
 * Voice score (author-voice plan, stage 0, 2026-11-26).
 *
 * How close a text is to an author's own writing, measured in code with no
 * model: sentence shapes, person, punctuation habits and the mix of small
 * function words. These are the things a writer does without thinking, so
 * they survive a change of topic, which is what makes them a fingerprint.
 *
 * The method is the standard one for authorship work (Burrows's Delta): every
 * feature is put on a common scale using a reference pool of several writers,
 * and two texts are compared by their average distance across features.
 *
 * What the score can and cannot say:
 *  - it compares MANNER only. It knows nothing about beliefs or about who the
 *    author is; those are judged elsewhere.
 *  - it needs enough text. Under about 400 words the numbers are noise.
 *  - speech and writing differ. A profile built from spoken answers will sit
 *    further from any written article than one built from essays.
 */

/** Words that carry grammar, not topic. Their mix is the most topic-proof part of a voice. */
const FUNCTION_WORDS = [
  'the', 'of', 'and', 'a', 'to', 'in', 'is', 'that', 'it', 'for', 'with', 'as', 'on', 'be', 'at', 'by', 'this', 'are', 'or', 'an',
  'but', 'not', 'what', 'all', 'when', 'can', 'there', 'if', 'so', 'which', 'do', 'how', 'will', 'about', 'out', 'up', 'then', 'them', 'these', 'some',
  'would', 'more', 'has', 'have', 'had', 'been', 'was', 'were', 'because', 'into', 'than', 'its', 'only', 'also', 'even', 'most', 'from', 'they', 'their', 'one',
]
const FP_SINGULAR = new Set(['i', "i'm", "i've", "i'd", "i'll", 'me', 'my', 'mine', 'myself'])
const FP_PLURAL = new Set(['we', "we're", "we've", "we'd", "we'll", 'us', 'our', 'ours', 'ourselves'])
const SECOND = new Set(['you', "you're", "you've", "you'd", "you'll", 'your', 'yours', 'yourself'])
const INTENSIFIERS = new Set(['very', 'really', 'just', 'quite', 'truly', 'simply', 'actually', 'absolutely', 'incredibly', 'totally', 'so', 'such', 'pretty'])
const HEDGES = new Set(['may', 'might', 'could', 'perhaps', 'often', 'usually', 'generally', 'tends', 'tend', 'likely', 'sometimes', 'probably', 'seems', 'appears'])
const OPEN_CONJ = new Set(['and', 'but', 'so', 'or', 'yet', 'because', 'now', 'well'])

/**
 * The running prose of an article or essay: markup, headings, lists of links,
 * figures, tables and code removed. Headings and captions are left out on
 * purpose: they are format, and the format is ours, not the author's.
 */
export function toProse(input: string): string {
  let t = input
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t
      .replace(/<(script|style|figure|table|nav|aside|pre|code)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '\n')
      .replace(/<\/(p|li|div|blockquote|section)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  } else {
    // markdown from the writer's draft
    t = t
      .replace(/^#{1,6}\s.*$/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[*_`>]+/g, '')
  }
  return t
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|’/g, "'")
    .replace(/&#8216;|&lsquo;|‘/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|[“”]/g, '"')
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function splitSentences(prose: string): string[] {
  return prose
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]{2}/.test(s))
}

const wordsOf = (s: string): string[] => s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []

export type VoiceFeatures = Record<string, number>

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

/** The measurable habits of a text. Rates are per 100 words; shares are per sentence. */
export function voiceFeatures(input: string): VoiceFeatures {
  const prose = toProse(input)
  const sentences = splitSentences(prose)
  const words = wordsOf(prose)
  const n = Math.max(1, words.length)
  const ns = Math.max(1, sentences.length)
  const per100 = (count: number) => (100 * count) / n
  const lens = sentences.map((s) => wordsOf(s).length).filter((l) => l > 0)
  const count = (set: Set<string>) => words.filter((w) => set.has(w)).length
  const firstWords = sentences.map((s) => wordsOf(s)[0] ?? '')

  const f: VoiceFeatures = {
    sentLenMean: mean(lens),
    sentLenSd: sd(lens),
    shortSentShare: lens.filter((l) => l <= 6).length / ns,
    longSentShare: lens.filter((l) => l >= 28).length / ns,
    wordLenMean: mean(words.map((w) => w.replace(/'/g, '').length)),
    longWordShare: words.filter((w) => w.length >= 9).length / n,
    fpSingular: per100(count(FP_SINGULAR)),
    fpPlural: per100(count(FP_PLURAL)),
    secondPerson: per100(count(SECOND)),
    questionShare: sentences.filter((s) => /\?["')\]]*$/.test(s)).length / ns,
    exclaimShare: sentences.filter((s) => /!["')\]]*$/.test(s)).length / ns,
    contractions: per100(words.filter((w) => w.includes("'") && !w.endsWith("'s")).length),
    commas: per100((prose.match(/,/g) ?? []).length),
    dashes: per100((prose.match(/[—–]| - /g) ?? []).length),
    colons: per100((prose.match(/:/g) ?? []).length),
    semicolons: per100((prose.match(/;/g) ?? []).length),
    parens: per100((prose.match(/\(/g) ?? []).length),
    quotes: per100((prose.match(/"/g) ?? []).length / 2),
    ellipses: per100((prose.match(/\.{3}|…/g) ?? []).length),
    capsWords: per100((prose.match(/\b[A-Z]{3,}\b/g) ?? []).length),
    conjOpenShare: firstWords.filter((w) => OPEN_CONJ.has(w)).length / ns,
    iOpenShare: firstWords.filter((w) => FP_SINGULAR.has(w)).length / ns,
    youOpenShare: firstWords.filter((w) => SECOND.has(w)).length / ns,
    intensifiers: per100(count(INTENSIFIERS)),
    hedges: per100(count(HEDGES)),
  }
  for (const fw of FUNCTION_WORDS) f[`fw_${fw}`] = per100(words.filter((w) => w === fw).length)
  return f
}

export const wordCount = (input: string): number => wordsOf(toProse(input)).length

/** Cut an author's material into pieces of about `size` words, on paragraph breaks, so habits can be averaged. */
export function chunkProse(input: string, size = 600): string[] {
  const paras = toProse(input).split(/\n+/).filter((p) => p.trim())
  const chunks: string[] = []
  let cur: string[] = []
  let n = 0
  for (const p of paras) {
    cur.push(p)
    n += wordsOf(p).length
    if (n >= size) {
      chunks.push(cur.join('\n'))
      cur = []
      n = 0
    }
  }
  if (n >= size / 2) chunks.push(cur.join('\n'))
  else if (cur.length && chunks.length) chunks[chunks.length - 1] += '\n' + cur.join('\n')
  else if (cur.length) chunks.push(cur.join('\n'))
  return chunks
}

export interface VoiceReference {
  /** Per feature: the pool's mean and spread, used to put every feature on one scale. */
  scale: Record<string, { mean: number; sd: number }>
  /** Per author: the average of their pieces, on that scale. */
  authors: Record<string, Record<string, number>>
  features: string[]
}

/** Build the reference from each author's pieces (already cut with chunkProse). */
export function buildReference(piecesByAuthor: Record<string, string[]>): VoiceReference {
  const perAuthor: Record<string, VoiceFeatures[]> = {}
  for (const [a, pieces] of Object.entries(piecesByAuthor)) perAuthor[a] = pieces.map(voiceFeatures)
  const all = Object.values(perAuthor).flat()
  const features = Object.keys(all[0] ?? {})
  const scale: VoiceReference['scale'] = {}
  for (const k of features) {
    const xs = all.map((f) => f[k])
    // A feature nobody varies on tells nothing; a floor keeps it from exploding the scale.
    scale[k] = { mean: mean(xs), sd: Math.max(sd(xs), 1e-6) }
  }
  const authors: VoiceReference['authors'] = {}
  for (const [a, fs] of Object.entries(perAuthor)) {
    authors[a] = {}
    for (const k of features) authors[a][k] = (mean(fs.map((f) => f[k])) - scale[k].mean) / scale[k].sd
  }
  return { scale, authors, features }
}

/** Features that barely vary in the pool are dropped from the comparison. */
function usable(ref: VoiceReference): string[] {
  return ref.features.filter((k) => ref.scale[k].sd > 1e-4)
}

/** Distance of a text from each author in the reference. Lower is closer. */
export function voiceDistances(text: string, ref: VoiceReference): Record<string, number> {
  const f = voiceFeatures(text)
  const keys = usable(ref)
  const out: Record<string, number> = {}
  for (const [a, prof] of Object.entries(ref.authors)) {
    out[a] = mean(keys.map((k) => Math.abs(Math.max(-4, Math.min(4, (f[k] - ref.scale[k].mean) / ref.scale[k].sd)) - prof[k])))
  }
  return out
}

export interface VoiceResult {
  /** Positive: closer to the author than to the average other writer. Zero or below: not distinguishable from them. */
  score: number
  /** 1 = the author is the closest writer in the reference. */
  rank: number
  distance: number
  nearest: string
  distances: Record<string, number>
}

/** How much a text sounds like `author`, against everyone else in the reference. */
export function voiceScore(text: string, author: string, ref: VoiceReference): VoiceResult {
  const distances = voiceDistances(text, ref)
  const own = distances[author]
  const others = Object.entries(distances).filter(([a]) => a !== author).map(([, d]) => d)
  const ordered = Object.entries(distances).sort((a, b) => a[1] - b[1])
  return {
    score: others.length ? 1 - own / mean(others) : 0,
    rank: ordered.findIndex(([a]) => a === author) + 1,
    distance: own,
    nearest: ordered[0][0],
    distances,
  }
}

/** The features on which a text sits furthest from the author, with direction: what to read when a score is poor. */
export function voiceGaps(text: string, author: string, ref: VoiceReference, top = 8): Array<{ feature: string; text: number; author: number; gap: number }> {
  const f = voiceFeatures(text)
  return usable(ref)
    .map((k) => {
      const z = (f[k] - ref.scale[k].mean) / ref.scale[k].sd
      return { feature: k, text: f[k], author: ref.authors[author][k] * ref.scale[k].sd + ref.scale[k].mean, gap: z - ref.authors[author][k] }
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, top)
}
