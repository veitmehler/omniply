/**
 * The author's voice profile (author-voice plan, stage 1, 2026-11-26).
 *
 * Built from what onboarding already collects: the seven spoken answers and
 * one piece of the author's own writing. Nothing else is asked of a client.
 *
 * Three parts, because "written as the author" is three things:
 *   - who they are and what they personally do,
 *   - what they believe,
 *   - how they write.
 *
 * The rule that governs the whole record: it holds the author's OWN WORDS. A
 * model reads the material and points at passages; code then checks that
 * every passage it pointed at really is in the material, word for word, and
 * drops any that is not. A description of a voice is what lost the voice; the
 * profile never stores one in place of the words.
 */
import { voiceFeatures, wordCount } from './voice-score'

export type QuestionId = 'q_declaration' | 'q_enemy' | 'q_myths' | 'q_tribe' | 'q_line' | 'q_moments' | 'q_proof'

/** The seven onboarding questions, as asked (apps/api/src/onboarding/flow.ts). */
export const ONBOARDING_QUESTIONS: Record<QuestionId, string> = {
  q_declaration: 'Imagine a patient describing your clinic to a friend three years from now. What do you want them to say you did for them?',
  q_enemy: "What's the one thing in your industry that drives you crazy, the thing patients keep falling for before they find you?",
  q_myths: 'Which myths about your field do you find yourself correcting again and again?',
  q_tribe: 'Describe your favorite patient, the one you wish you had 100 more of. Who are they, what does their life look like?',
  q_line: 'What do you refuse to compromise on, even when it costs you?',
  q_moments: "Tell me two or three short TRUE stories from running your practice: a mistake you fixed, a lesson that cost you something, a moment you're proud of.",
  q_proof: "Walk me through what actually happens in a patient's first visit and first month with you.",
}

export interface AuthorMaterial {
  author: { name: string; practice: string; industry: string; location: string; /** The job title on the account, when set. */ jobTitle?: string | null }
  brand: { businessDescription?: string | null; who?: string | null; ourExperience?: string | null }
  answers: Partial<Record<QuestionId, string>>
  /** The settings line "What the author does personally" (brand_settings.defaultAuthorOwnWork), when filled in. */
  ownWork?: string | null
  /** The one piece of their own writing, when they gave one. */
  sample: { text: string; title?: string } | null
  /** True when the answers were not spoken by the author but drawn from their writing (a simulated onboarding). */
  derivedAnswers?: boolean
}

export type BeliefKind = 'stands_for' | 'fights' | 'myth' | 'line'
type Where = 'opening' | 'closing' | 'explaining' | 'anywhere'

export interface VoiceProfile {
  version: 1
  author: AuthorMaterial['author']
  /** What the profile rests on. An author is only as recognisable as their material allows. */
  basis: {
    spokenWords: number
    sampleWords: number
    derivedAnswers: boolean
    quotesDropped: number
    /** What was dropped, so a person can see whether the builder is inventing or only mis-cutting. */
    dropped: string[]
  }
  identity: {
    role: string
    /**
     * The account's own statement of what the author does with patients or clients and what the team does.
     * This is the authority on the question; the quotes below only show how the author talks about it.
     */
    stated: string | null
    /** What the author says they do themselves, in their words. */
    does: string[]
    /** What they say the team or a colleague does. */
    teamDoes: string[]
  }
  beliefs: Array<{ kind: BeliefKind; statement: string; topics: string[] }>
  stories: Array<{ kind: 'own' | 'client'; text: string; topics: string[] }>
  manner: {
    habits: Array<{ habit: string; example: string; where: Where; seen: number }>
    phrases: string[]
    opening: { habit: string; example: string } | null
    closing: { habit: string; example: string } | null
    reader: string
    /**
     * Measured on the author's own words: the numbers the wording limits are set from.
     * Answers and the written piece are kept apart, because a piece can be an outline or
     * a script, and its fragments would pass for a habit of short sentences.
     */
    measured: { answers: Record<string, number> | null; sample: Record<string, number> | null }
    /** The words themselves: every answer and the sample, lightly cleaned. This is what a writer is shown. */
    ownWords: Array<{ source: QuestionId | 'sample'; text: string }>
  }
}

/** Spoken filler removed; nothing else is touched. The author's words stay the author's. */
export function cleanSpoken(text: string): string {
  return text
    .replace(/\b(?:um+|uh+|erm+|hmm+)\b[,.]?\s*/gi, '')
    // A stammer ("I I think") goes; a real double ("she had had", "that that") stays.
    .replace(/\b(\w+)(\s+\1\b){1,}/gi, (all, w: string) => (/^(had|that)$/i.test(w) ? all : w))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}

/** One letter added, dropped or swapped. */
function nearly(a: string, b: string): boolean {
  if (a === b) return false
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let x = a.length - 1
  let y = b.length - 1
  while (x >= i && y >= i && a[x] === b[y]) {
    x--
    y--
  }
  return Math.max(x - i, y - i) <= 0
}

/**
 * A transcript often mishears the practice's own name ("Wealth Recovery Center"
 * for Whealth). Where the rest of the name follows, the first word is put right.
 */
export function fixPracticeName(text: string, practice: string): string {
  const [first, ...rest] = practice.trim().split(/\s+/)
  if (!first || rest.length === 0) return text
  const tail = rest.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  return text.replace(new RegExp(`\\b([A-Za-z]+)(\\s+${tail})\\b`, 'gi'), (all, w: string, t: string) => (nearly(w.toLowerCase(), first.toLowerCase()) ? first + t : all))
}

/** Clean the material once, before anything reads it: the builder quotes from this text and is checked against it. */
export function prepareMaterial(m: AuthorMaterial): AuthorMaterial {
  const answers: AuthorMaterial['answers'] = {}
  for (const q of Object.keys(ONBOARDING_QUESTIONS) as QuestionId[]) {
    const a = m.answers[q]?.trim()
    if (a) answers[q] = fixPracticeName(m.derivedAnswers ? a : cleanSpoken(a), m.author.practice)
  }
  // Bullet marks are layout, and a note in brackets or capitals ("[PAUSE. Move to the easel]", "(SHOW)") is a
  // direction to the speaker. Neither is the author's wording.
  const tidy = (t: string) =>
    t
      // A list mark is never a word, wherever it sits and whatever space surrounds it.
      .replace(/^[^\S\n]*[•▪◦·■●□○→][^\S\n]*/gm, '')
      .replace(/[^\S\n]*[•▪◦■●□○][^\S\n]*/g, ' ')
      // A heading inside the piece ("The Setup — I Had Everything") is layout too: a short line that
      // ends without punctuation. Left in, it lands in the middle of a story cut from the lines around it.
      .split('\n')
      .filter((line) => {
        const l = line.trim()
        if (!l) return true
        const words = l.split(/\s+/).length
        return !(words <= 9 && !/[.!?…:;,"”’)]$/.test(l) && /^[A-Z0-9“"]/.test(l))
      })
      .join('\n')
      .replace(/\[[^\]\n]{0,240}\]/g, ' ')
      .replace(/\((?:[A-Z]{3,}[ .,]*)+\)/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.!?;:])/g, '$1')
  const sample = m.sample?.text.trim() ? { ...m.sample, text: tidy(m.sample.text) } : null
  return { ...m, answers, sample }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Is this passage really in the material, word for word? Punctuation and case
 * are forgiven, and a passage the model shortened with "..." is accepted when
 * every part is there. Anything else is a paraphrase and is refused.
 */
export function isVerbatim(passage: string, material: string): boolean {
  const hay = norm(material)
  const parts = passage.split(/\.{3,}|…|\[\.\.\.\]/).map(norm).filter((p) => p.split(' ').length >= 3)
  if (parts.length === 0) return false
  return parts.every((p) => hay.includes(p))
}

/** The text as `norm` would give it, with the place in the original of every character kept. */
function normWithPlaces(text: string): { n: string; at: number[] } {
  let n = ''
  const at: number[] = []
  let gap = true
  for (let i = 0; i < text.length; i++) {
    let c = text[i].toLowerCase()
    if (c === '\u2018' || c === '\u2019') c = "'"
    if (/[a-z0-9']/.test(c)) {
      n += c
      at.push(i)
      gap = false
    } else if (!gap) {
      n += ' '
      at.push(i)
      gap = true
    }
  }
  return { n, at }
}

/** Cut the passage that runs from `starts` to `ends` out of the material, in the material's own wording. */
export function slicePassage(material: string, starts: string, ends: string): string | null {
  const flat = material.replace(/\s+/g, ' ')
  const { n, at } = normWithPlaces(flat)
  // Whole words only, so "art" is not found inside "start".
  const locate = (needle: string, from: number): [number, number] | null => {
    const want = norm(needle)
    if (want.split(' ').length < 3) return null
    for (let i = n.indexOf(want, from); i !== -1; i = n.indexOf(want, i + 1)) {
      const end = i + want.length
      if ((i === 0 || n[i - 1] === ' ') && (end === n.length || n[end] === ' ')) return [i, end]
    }
    return null
  }
  const a = locate(starts, 0)
  if (!a) return null
  const b = locate(ends, a[0])
  if (!b) return null
  let from = at[a[0]]
  let to = at[b[1] - 1] + 1
  // The cut keeps the quote mark it opens with and the full stop it ends on.
  while (from > 0 && /["\u201c\u2018(]/.test(flat[from - 1])) from--
  while (to < flat.length && /[.!?"\u201d\u2019)\u2026]/.test(flat[to])) to++
  return flat.slice(from, to).trim()
}

export function allOwnText(m: AuthorMaterial): string {
  return [...Object.values(m.answers), m.sample?.text ?? ''].filter(Boolean).join('\n\n')
}

export function profilePrompt(m: AuthorMaterial): string {
  const answers = (Object.keys(ONBOARDING_QUESTIONS) as QuestionId[])
    .filter((q) => m.answers[q]?.trim())
    .map((q) => `[${q}] Asked: ${ONBOARDING_QUESTIONS[q]}\nAnswer: ${m.answers[q]}`)
    .join('\n\n')
  return (
    `You are preparing a record of how one person thinks and writes, so that later writing can be done as them. The record holds THEIR OWN WORDS. You point at passages; you never rephrase them.\n\n` +
    `PERSON: ${m.author.name}, ${m.author.industry}, ${m.author.practice}, ${m.author.location}.\n` +
    (m.brand.ourExperience ? `About the practice (written by others, context only): ${m.brand.ourExperience}\n` : '') +
    (m.ownWork?.trim() ? `What they do themselves and what their team does (from the account, context only, never to be quoted): ${m.ownWork.trim()}\n` : '') +
    `\nTHEIR ANSWERS${m.derivedAnswers ? ' (taken from their own writing)' : ' (spoken, transcribed)'}:\n${answers}\n\n` +
    (m.sample ? `A PIECE THEY WROTE${m.sample.title ? ` ("${m.sample.title}")` : ''}:\n${m.sample.text.slice(0, 16000)}\n\n` : 'They gave no written piece.\n\n') +
    `Return ONLY this JSON object. Every "quote", "example", "starts" and "ends" must be copied character for character from the material above. If you cannot quote it, leave it out.\n` +
    `{\n` +
    ` "role": "<their role in their own terms, at most 12 words>",\n` +
    ` "does": ["<quote: a sentence in which they say what THEY personally do with the people they serve>", ...],\n` +
    ` "team_does": ["<quote: a sentence in which they say what a colleague or the team does>", ...],\n` +
    ` "beliefs": [{"kind": "stands_for|fights|myth|line", "quote": "<one or two of their sentences stating the belief>", "topics": ["<2 to 4 plain topic words this belief bears on>"]}, ...],\n` +
    ` "stories": [{"kind": "own|client", "starts": "<the first 8 words of the story>", "ends": "<the last 6 words of the story>", "topics": ["<2 to 4 topic words>"]}, ...],\n` +
    ` "habits": [{"habit": "<a writing or speaking habit, described in at most 14 words>", "example": "<quote showing it>", "where": "opening|closing|explaining|anywhere", "seen": <how many times it appears in the material>}, ...],\n` +
    ` "phrases": ["<quote: a short turn of phrase that is distinctly theirs, 2 to 8 words>", ...],\n` +
    ` "opening": {"habit": "<how they begin a piece or an answer>", "example": "<quote>"} or null,\n` +
    ` "closing": {"habit": "<how they end one>", "example": "<quote>"} or null,\n` +
    ` "reader": "<how they address the person they are talking to, at most 20 words>"\n` +
    `}\n\n` +
    `Guidance:\n` +
    `- beliefs: 8 to 14, covering what they stand for, what they argue against, the myths they correct and the lines they will not cross. Prefer the sentences where they sound most like themselves.\n` +
    `- stories: every real moment or case they tell, each cut at its natural start and end.\n` +
    `- habits: 6 to 10 that a reader would recognise them by. Rhythm, how they build a point, humour, the kind of images they reach for, how sure they sound. Only habits the material actually shows, with an honest count.\n` +
    `- If the written piece is an outline, a script or notes, take beliefs and stories from it but do not report its layout as a habit.`
  )
}

interface RawProfile {
  role?: unknown
  does?: unknown
  team_does?: unknown
  beliefs?: unknown
  stories?: unknown
  habits?: unknown
  phrases?: unknown
  opening?: unknown
  closing?: unknown
  reader?: unknown
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [])
const topicsOf = (v: unknown): string[] => strings(v).map((t) => t.toLowerCase()).slice(0, 5)

/** Turn the model's pointers into a profile, keeping only what is truly in the material. */
export function assembleProfile(m: AuthorMaterial, rawJson: string): VoiceProfile {
  const own = allOwnText(m)
  const droppedList: string[] = []
  const keep = (q: string): boolean => {
    const ok = isVerbatim(q, own)
    if (!ok) droppedList.push(q.slice(0, 200))
    return ok
  }
  let raw: RawProfile = {}
  try {
    raw = JSON.parse(rawJson.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as RawProfile
  } catch {
    raw = {}
  }
  const beliefs = (Array.isArray(raw.beliefs) ? (raw.beliefs as Array<Record<string, unknown>>) : [])
    .map((b) => ({ kind: String(b.kind ?? '').trim() as BeliefKind, statement: String(b.quote ?? '').trim(), topics: topicsOf(b.topics) }))
    .filter((b) => ['stands_for', 'fights', 'myth', 'line'].includes(b.kind) && b.statement && keep(b.statement))
  const stories = (Array.isArray(raw.stories) ? (raw.stories as Array<Record<string, unknown>>) : [])
    .map((s) => {
      const text = slicePassage(own, String(s.starts ?? ''), String(s.ends ?? ''))
      if (!text) droppedList.push(`story: ${String(s.starts ?? '').slice(0, 80)} … ${String(s.ends ?? '').slice(0, 60)}`)
      return { kind: (String(s.kind) === 'client' ? 'client' : 'own') as 'own' | 'client', text: text ?? '', topics: topicsOf(s.topics) }
    })
    .filter((s) => s.text && wordCount(s.text) >= 15)
  const habits = (Array.isArray(raw.habits) ? (raw.habits as Array<Record<string, unknown>>) : [])
    .map((h) => ({
      habit: String(h.habit ?? '').trim().slice(0, 160),
      example: String(h.example ?? '').trim(),
      where: (['opening', 'closing', 'explaining', 'anywhere'].includes(String(h.where)) ? String(h.where) : 'anywhere') as Where,
      seen: Math.max(1, Math.round(Number(h.seen) || 1)),
    }))
    .filter((h) => h.habit && h.example && keep(h.example))
  const edge = (v: unknown): { habit: string; example: string } | null => {
    const o = v as Record<string, unknown> | null
    if (!o || typeof o !== 'object') return null
    const example = String(o.example ?? '').trim()
    return o.habit && example && keep(example) ? { habit: String(o.habit).trim().slice(0, 160), example } : null
  }
  const MEASURED = ['sentLenMean', 'sentLenSd', 'shortSentShare', 'longSentShare', 'questionShare', 'exclaimShare', 'fpSingular', 'fpPlural', 'secondPerson', 'contractions', 'conjOpenShare', 'dashes', 'capsWords']
  const measure = (text: string): Record<string, number> | null => {
    if (wordCount(text) < 150) return null
    const f = voiceFeatures(text)
    return Object.fromEntries(MEASURED.map((k) => [k, Number(f[k].toFixed(3))]))
  }

  const ownWords: VoiceProfile['manner']['ownWords'] = []
  for (const q of Object.keys(ONBOARDING_QUESTIONS) as QuestionId[]) if (m.answers[q]?.trim()) ownWords.push({ source: q, text: m.answers[q]!.trim() })
  if (m.sample?.text.trim()) ownWords.push({ source: 'sample', text: m.sample.text.trim() })
  const measured = { answers: measure(Object.values(m.answers).join('\n')), sample: measure(m.sample?.text ?? '') }

  // The settings line is the account's statement, not something the author said in their material. A builder
  // that quotes it back is not inventing, so those are skipped quietly instead of being listed as dropped.
  const fromSettings = (q: string) => !!m.ownWork?.trim() && isVerbatim(q, m.ownWork)
  const does = strings(raw.does).filter((q) => !fromSettings(q)).filter(keep)
  const teamDoes = strings(raw.team_does).filter((q) => !fromSettings(q)).filter(keep)
  const opening = edge(raw.opening)
  const closing = edge(raw.closing)
  // A turn of phrase can be two words, so it is checked directly; isVerbatim wants three.
  const phrases = strings(raw.phrases).filter((p) => p.split(/\s+/).length <= 10 && norm(p).length >= 5 && norm(own).includes(norm(p))).slice(0, 16)

  // Built last: the count of dropped passages is only complete once every part has been checked.
  return {
    version: 1,
    author: m.author,
    basis: { spokenWords: wordCount(Object.values(m.answers).join('\n')), sampleWords: m.sample ? wordCount(m.sample.text) : 0, derivedAnswers: !!m.derivedAnswers, quotesDropped: droppedList.length, dropped: droppedList },
    identity: { role: String(raw.role ?? '').trim().slice(0, 120), stated: m.ownWork?.trim() || null, does, teamDoes },
    beliefs,
    stories,
    manner: { habits, phrases, opening, closing, reader: String(raw.reader ?? '').trim().slice(0, 200), measured, ownWords },
  }
}

/** For a simulated onboarding: the question a set of essays is asked, to find the author's own answer in them. */
export function backfillPrompt(authorName: string, essays: Array<{ title: string; text: string }>): string {
  return (
    `Below are essays written by ${authorName}. A new client of ours answers seven questions out loud. This author never did, so find their answers in what they wrote.\n` +
    `For each question, pick the passages in which the author comes closest to answering it, in their own words. The essays were not written to answer these questions, so take the nearest thing they say: what they want for the people they care for, what they argue against, what they will not give up, a moment from their own life or practice, how they describe working with someone. Copy passages character for character. Do not write anything yourself. Leave a question empty only when nothing in the essays comes near it.\n\n` +
    (Object.keys(ONBOARDING_QUESTIONS) as QuestionId[]).map((q) => `[${q}] ${ONBOARDING_QUESTIONS[q]}`).join('\n') +
    `\n\nESSAYS\n` +
    essays.map((e) => `=== ${e.title} ===\n${e.text}`).join('\n\n') +
    `\n\nReturn ONLY this JSON object, with 2 to 4 passages per question and 150 to 230 words per question in total. A passage is whole sentences, usually a paragraph, and no passage is used for two questions:\n` +
    `{"q_declaration": [{"starts": "<first 8 words of the passage>", "ends": "<last 6 words of the passage>"}], "q_enemy": [...], "q_myths": [...], "q_tribe": [...], "q_line": [...], "q_moments": [...], "q_proof": [...]}`
  )
}

/** Build the seven answers from the passages the model pointed at; a passage that cannot be found is left out. */
export function assembleBackfill(rawJson: string, essays: Array<{ title: string; text: string }>): { answers: Partial<Record<QuestionId, string>>; dropped: number } {
  const all = essays.map((e) => e.text).join('\n\n')
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(rawJson.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Record<string, unknown>
  } catch {
    raw = {}
  }
  const answers: Partial<Record<QuestionId, string>> = {}
  let dropped = 0
  for (const q of Object.keys(ONBOARDING_QUESTIONS) as QuestionId[]) {
    const parts: string[] = []
    for (const p of Array.isArray(raw[q]) ? (raw[q] as Array<Record<string, unknown>>) : []) {
      const text = slicePassage(all, String(p.starts ?? ''), String(p.ends ?? ''))
      if (text && wordCount(text) >= 8 && wordCount(text) <= 320) parts.push(text)
      else dropped++
    }
    if (parts.length) answers[q] = parts.join(' ')
  }
  return { answers, dropped }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/** The profile as a page a person can read and judge: is this a fair portrait? */
export function profileToMarkdown(p: VoiceProfile): string {
  const ma = p.manner.measured.answers
  const ms = p.manner.measured.sample
  const kinds: Record<BeliefKind, string> = { stands_for: 'What they stand for', fights: 'What they argue against', myth: 'Myths they correct', line: 'Lines they will not cross' }
  const out: string[] = []
  out.push(`# Voice profile: ${p.author.name}`)
  out.push(`${p.identity.role || p.author.industry}, ${p.author.practice}, ${p.author.location}`)
  out.push(`\n## What this profile rests on\n`)
  out.push(`- Answers to the seven onboarding questions: ${p.basis.spokenWords} words${p.basis.derivedAnswers ? ' (not spoken: taken from their own essays, as a stand-in for onboarding)' : ' (spoken)'}`)
  out.push(`- One piece of their own writing: ${p.basis.sampleWords} words`)
  out.push(`- Passages the builder pointed at that were not found word for word, and were left out: ${p.basis.quotesDropped}`)
  for (const d of p.basis.dropped) out.push(`  - "${d}"`)
  out.push(`\n## Who they are and what they do\n`)
  out.push(p.identity.stated ? `From the account settings: ${p.identity.stated}\n` : 'The account settings do not say what the author does personally. Until they do, "I" is kept for what the author believes, saw and decided, and treatment is written as "we".\n')
  out.push(p.identity.does.length ? `In their own words:\n` + p.identity.does.map((d) => `- "${d}"`).join('\n') : '- Their material has no sentence about what they personally do.')
  if (p.identity.teamDoes.length) out.push(`\nWhat they say the team does:\n` + p.identity.teamDoes.map((d) => `- "${d}"`).join('\n'))
  out.push(`\n## What they believe\n`)
  for (const k of Object.keys(kinds) as BeliefKind[]) {
    const bs = p.beliefs.filter((b) => b.kind === k)
    if (!bs.length) continue
    out.push(`**${kinds[k]}**\n`)
    out.push(bs.map((b) => `- "${b.statement}"${b.topics.length ? `  \n  Bears on: ${b.topics.join(', ')}` : ''}`).join('\n'))
    out.push('')
  }
  out.push(`## Their stories\n`)
  out.push(p.stories.length ? p.stories.map((s, i) => `${i + 1}. (${s.kind === 'client' ? 'a client' : 'their own'}; ${s.topics.join(', ') || 'no topic'}) "${s.text}"`).join('\n\n') : 'None in the material.')
  out.push(`\n## How they write\n`)
  out.push(`**Habits a reader would know them by**\n`)
  out.push(p.manner.habits.map((h) => `- ${h.habit} (seen ${h.seen} time${h.seen === 1 ? '' : 's'}; ${h.where})  \n  "${h.example}"`).join('\n'))
  if (p.manner.opening) out.push(`\n**How they open:** ${p.manner.opening.habit}  \n"${p.manner.opening.example}"`)
  if (p.manner.closing) out.push(`\n**How they close:** ${p.manner.closing.habit}  \n"${p.manner.closing.example}"`)
  if (p.manner.reader) out.push(`\n**How they speak to the reader:** ${p.manner.reader}`)
  if (p.manner.phrases.length) out.push(`\n**Turns of phrase:** ` + p.manner.phrases.map((x) => `"${x}"`).join(', '))
  out.push(`\n**Measured on their own words**\n`)
  const row = (label: string, k: string, fmt: (x: number) => string) => `| ${label} | ${ma ? fmt(ma[k]) : 'too little text'} | ${ms ? fmt(ms[k]) : 'none'} |`
  const words = (x: number) => `${x.toFixed(0)} words`
  const rate = (x: number) => x.toFixed(1)
  out.push(`| Habit | In their answers | In their written piece |\n|---|---|---|`)
  out.push(row('Average sentence', 'sentLenMean', words))
  out.push(row('Very short sentences (6 words or fewer)', 'shortSentShare', pct))
  out.push(row('Long sentences (28 words or more)', 'longSentShare', pct))
  out.push(row('Sentences that are questions', 'questionShare', pct))
  out.push(row('Sentences ending in an exclamation mark', 'exclaimShare', pct))
  out.push(row('"I", "my", "me" per 100 words', 'fpSingular', rate))
  out.push(row('"we", "our" per 100 words', 'fpPlural', rate))
  out.push(row('"you", "your" per 100 words', 'secondPerson', rate))
  out.push(row('Sentences opening with And, But, So, Well', 'conjOpenShare', pct))
  out.push(row('Contractions per 100 words', 'contractions', rate))
  out.push(`\n## Their own words, as a writer would be shown them\n`)
  out.push(p.manner.ownWords.map((w) => `**${w.source === 'sample' ? 'Their written piece' : ONBOARDING_QUESTIONS[w.source]}** (${wordCount(w.text)} words)\n\n${w.text.length > 1400 ? w.text.slice(0, 1400).trimEnd() + ' […]' : w.text}`).join('\n\n'))
  return out.join('\n')
}
