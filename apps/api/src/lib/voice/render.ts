/**
 * What a writing step is shown of the author (author-voice plan, stage 2).
 *
 * The profile is a record; this turns it into the text a model reads. Two
 * sizes: the full one for the article writer (the author's own words first and
 * with the most room), and a short one for steps that repair one sentence.
 *
 * Two rules decide what is shown:
 *  - The author's words are shown as they are. A description of a voice is what
 *    lost the voice.
 *  - A client's case told in the onboarding answers is NOT shown. It is raw:
 *    ages, conditions, outcome claims. Cases reach an article only through the
 *    story bank, which has been cleaned. The author's own stories stay.
 */
import { ONBOARDING_QUESTIONS, type BeliefKind, type VoiceProfile } from './profile'
import { wordCount } from './voice-score'
import { contrastShare } from '../text/contrast'

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Answers that describe a real client, whatever else they say. They are never shown to a writing step. */
const ABOUT_A_CLIENT = new Set<string>(['q_tribe'])

/** The author's words with every client case cut out. */
export function ownWordsForWriter(p: VoiceProfile): VoiceProfile['manner']['ownWords'] {
  const cases = p.stories.filter((s) => s.kind === 'client').map((s) => flat(s.text)).filter((t) => t.length > 40)
  const out: VoiceProfile['manner']['ownWords'] = []
  for (const w of p.manner.ownWords) {
    // "Describe your favourite patient" is an answer about a real, often named, person.
    if (ABOUT_A_CLIENT.has(w.source)) continue
    let text = w.text
    for (const c of cases) {
      if (flat(text).includes(c)) text = flat(text).replace(c, ' ').replace(/\s+/g, ' ').trim()
    }
    if (wordCount(text) >= 15) out.push({ source: w.source, text })
  }
  return out
}

/** Everything the author said, in one normalised string: for asking "does this author use that phrase themselves?". */
export function authorSays(p: VoiceProfile): string {
  return p.manner.ownWords
    .map((w) => w.text)
    .join(' ')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
}

/**
 * The measurement that describes the author's running prose. A written piece in
 * fragments (an outline, a script) would pass for a habit of very short
 * sentences, so the answers are used instead when the piece looks like one.
 */
export function proseMeasure(p: VoiceProfile): Record<string, number> | null {
  const { answers, sample } = p.manner.measured
  if (sample && !isFragments(p)) return sample
  return answers ?? sample
}

export function isFragments(p: VoiceProfile): boolean {
  const s = p.manner.measured.sample
  return !!s && s.shortSentShare > 0.4 && s.sentLenMean < 10
}

export interface AuthorLimits {
  /** Share of sentences that may be questions. */
  questionShare: number
  /** Share of sentences that may end in an exclamation mark. */
  exclaimShare: number
  /** Words in capitals for emphasis, per 100 words. */
  capsPer100: number
  /** Share of sentences that may set one thing against another ("this, not that"). */
  contrastShare: number
}

/** The author's own rate of a habit: the higher of what their answers and their written piece show. */
export function ownRate(p: VoiceProfile, key: string): number {
  const rates = [p.manner.measured.answers, p.manner.measured.sample].filter((m): m is Record<string, number> => !!m)
  return Math.max(0, ...rates.map((m) => m[key] ?? 0))
}

/** What any author may do without it reading as a tic. */
export const DEFAULT_LIMITS: AuthorLimits = { questionShare: 0.04, exclaimShare: 0.004, capsPer100: 0.05, contrastShare: 0.02 }

/** How often the author sets one thing against another in a sentence, counted on everything they said or wrote. */
export function ownContrastShare(p: VoiceProfile): number {
  return contrastShare(p.manner.ownWords.map((w) => w.text))
}

/**
 * Wording limits relative to the author: the default for everyone, raised for an
 * author whose own material shows the habit. A habit is a tell only when this
 * author does not have it. The headroom keeps an article from being held to the
 * exact rate of a few hundred words of material.
 */
export function authorLimits(p: VoiceProfile, headroom = 1.5): AuthorLimits {
  const top = (k: string) => ownRate(p, k)
  return {
    questionShare: Math.max(DEFAULT_LIMITS.questionShare, top('questionShare') * headroom),
    exclaimShare: Math.max(DEFAULT_LIMITS.exclaimShare, top('exclaimShare') * headroom),
    capsPer100: Math.max(DEFAULT_LIMITS.capsPer100, top('capsWords') * headroom),
    contrastShare: Math.max(DEFAULT_LIMITS.contrastShare, ownContrastShare(p) * headroom),
  }
}

const KINDS: Record<BeliefKind, string> = {
  stands_for: 'What you stand for',
  fights: 'What you argue against',
  myth: 'Myths you correct',
  line: 'Lines you will not cross',
}

const oneIn = (share: number): string => {
  if (share <= 0.004) return 'almost never'
  const n = Math.round(1 / share)
  return n <= 1 ? 'most of the time' : `about one in ${n}`
}

function identityLines(p: VoiceProfile): string[] {
  const a = p.author
  const title = a.jobTitle?.trim() || p.identity.role
  const lines = [`You are ${a.name}${title ? `, ${title}` : ''}, at ${a.practice} in ${a.location}.`]
  lines.push(
    p.identity.stated
      ? `What you do yourself and what others on your team do: ${p.identity.stated}\nWrite "I" only for work this says is yours. Work it gives to a colleague is "we", "our team", or that colleague by role.`
      : `Your account does not say which work you do with your own hands. Write "I" for what you believe, have seen and have decided. Write "we" for assessment and treatment.`,
  )
  return lines
}

function habitLines(p: VoiceProfile): string[] {
  const m = proseMeasure(p)
  const out: string[] = []
  if (m) {
    out.push(`- Your sentences run about ${Math.round(m.sentLenMean)} words on average. Very short ones (six words or fewer): ${oneIn(m.shortSentShare)}. Long ones (28 words or more): ${oneIn(m.longSentShare)}.`)
    out.push(`- A question: ${oneIn(ownRate(p, 'questionShare'))} of your sentences. An exclamation mark: ${oneIn(ownRate(p, 'exclaimShare'))}.`)
    out.push(`- You say "I" about ${m.fpSingular.toFixed(1)} times, "we" about ${m.fpPlural.toFixed(1)} times and "you" about ${ownRate(p, 'secondPerson').toFixed(1)} times in a hundred words.`)
    if (m.conjOpenShare >= 0.04) out.push(`- You start ${oneIn(m.conjOpenShare)} of your sentences with And, But, So or Well.`)
    out.push(`- Setting one thing against another inside a sentence ("this, not that", "X rather than Y"): ${oneIn(ownContrastShare(p))} of your sentences. A whole article of yours holds three or four at most.`)
  }
  if (p.manner.reader) out.push(`- How you speak to the reader: ${p.manner.reader}`)
  if (p.manner.opening) out.push(`- How you begin: ${p.manner.opening.habit}. For example: "${p.manner.opening.example}"`)
  if (p.manner.closing) out.push(`- How you end: ${p.manner.closing.habit}. For example: "${p.manner.closing.example}"`)
  for (const h of p.manner.habits) out.push(`- ${h.habit}. For example: "${h.example}"`)
  if (p.manner.habits.length) out.push('- The examples show each habit; they are not lines to reuse. A catchphrase, an interjection or a joke of yours appears once in an article at most.')
  if (p.manner.phrases.length) out.push(`- Turns of phrase that are yours, to use where one fits and never to force: ${p.manner.phrases.map((x) => `"${x}"`).join(', ')}`)
  return out
}

/** Cut a text to about `words` words, at a paragraph or sentence end. */
export function clip(text: string, words: number): string {
  if (wordCount(text) <= words) return text
  const parts = text.split(/(?<=[.!?…]["”’)]?)\s+|\n+/)
  const kept: string[] = []
  let n = 0
  for (const part of parts) {
    const w = wordCount(part)
    if (n + w > words && kept.length) break
    kept.push(part)
    n += w
  }
  return kept.join(' ').trim()
}

/** The full rendering for the article writer. */
export function renderAuthorVoice(p: VoiceProfile, opts: { maxOwnWords?: number; restStories?: Set<number> } = {}): string {
  const budget = opts.maxOwnWords ?? 4200
  const out: string[] = []
  out.push('## Who you are', ...identityLines(p))

  if (p.beliefs.length) {
    out.push('', '## What you believe', 'These are your own sentences. They are your positions, and an article of yours is built on them.')
    for (const k of Object.keys(KINDS) as BeliefKind[]) {
      const bs = p.beliefs.filter((b) => b.kind === k)
      if (bs.length) out.push(`${KINDS[k]}:`, ...bs.map((b) => `- "${b.statement}"`))
    }
  }

  // A story told in a recent article rests: it is not shown, so it cannot be retold.
  const own = p.stories.filter((s) => s.kind === 'own').filter((_, i) => !opts.restStories?.has(i))
  if (own.length) {
    out.push('', '## Stories of your own', 'Told by you, in your words. One may be used where it bears on the topic, retold at the length the article needs and with nothing added to it. Your Take names the one that fits this article best, when one does.')
    out.push(...own.map((s) => `- "${s.text}"`))
  }

  const words = ownWordsForWriter(p)
  if (words.length) {
    out.push(
      '',
      '## Your own words',
      'Everything below was said or written by you. This is how you sound: your words, your images, how you build a point, how sure you are, how you speak to the person in front of you. The article is written the way this person writes. Their subject below is not the article\'s subject; their manner is.',
    )
    const answers = words.filter((w) => w.source !== 'sample')
    const sample = words.find((w) => w.source === 'sample')
    if (answers.length) {
      out.push(
        p.basis.derivedAnswers
          ? 'Passages from your own writing, under the question each one answers:'
          : 'Your answers, spoken aloud, under the question each one answered. Keep their wording and their attitude. On the page you leave out the loose ends of speech.',
      )
      for (const w of answers) out.push(`Asked: ${ONBOARDING_QUESTIONS[w.source as keyof typeof ONBOARDING_QUESTIONS]}`, `You: ${w.text}`, '')
    }
    if (sample) {
      const room = Math.max(400, budget - answers.reduce((n, w) => n + wordCount(w.text), 0))
      out.push(
        isFragments(p)
          ? 'A piece you wrote. It is in notes and fragments; the wording and the images are yours, the clipped layout is not how you write an article:'
          : 'A piece you wrote:',
        clip(sample.text, room),
      )
    }
  }

  const habits = habitLines(p)
  if (habits.length) out.push('', '## Your habits, counted on your own words', 'A habit is used about as often as you use it. Used in every paragraph it becomes a caricature of you.', ...habits)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The short rendering, for a step that repairs one sentence or one paragraph as the author. */
export function renderAuthorVoiceShort(p: VoiceProfile, opts: { excerptWords?: number } = {}): string {
  const each = opts.excerptWords ?? 130
  const out: string[] = [identityLines(p)[0]]
  const beliefs = p.beliefs.slice(0, 4).map((b) => `- "${b.statement}"`)
  if (beliefs.length) out.push('Things you have said:', ...beliefs)
  const words = ownWordsForWriter(p)
  // Opinions carry the most voice. A written piece in fragments is left out here: its first lines are stage notes.
  const sample = isFragments(p) ? undefined : words.find((w) => w.source === 'sample')
  const PREFER = ['q_enemy', 'q_myths', 'q_line', 'q_declaration', 'q_proof', 'q_moments']
  const answers = PREFER.map((q) => words.find((w) => w.source === q)).filter((w): w is NonNullable<typeof w> => !!w)
  const excerpts = [sample, ...answers].filter((w): w is NonNullable<typeof w> => !!w).slice(0, 2)
  if (excerpts.length) out.push('How you sound, in your own words:', ...excerpts.map((w) => `"${clip(w.text, each)}"`))
  const m = proseMeasure(p)
  if (m) out.push(`Your sentences run about ${Math.round(m.sentLenMean)} words. You say "you" about ${ownRate(p, 'secondPerson').toFixed(1)} times in a hundred words.`)
  if (p.manner.phrases.length) out.push(`Turns of phrase that are yours: ${p.manner.phrases.slice(0, 6).map((x) => `"${x}"`).join(', ')}`)
  return out.join('\n')
}
