/**
 * The author's take (author-voice plan, stage 2, section 2).
 *
 * Before the writer starts, one step asks: what would THIS author say about
 * this topic? It picks, from the author's own material, the beliefs, the myth
 * and the story that bear on the topic, and states the position in a few lines.
 * The article is then built around that position, with research in support.
 *
 * The step chooses by number from the profile; code attaches the author's own
 * sentences, so nothing reaches the writer as "the author believes" that the
 * author did not say. Where the material has nothing on the topic, the take
 * says so and the article keeps the author's manner without an invented view.
 */
import type { VoiceProfile } from '../../lib/voice/profile'

export interface Take {
  hasPosition: boolean
  /** A few first-person lines: what this author would say on this topic. */
  position: string
  /** Indexes into profile.beliefs. */
  beliefs: number[]
  /** Index into profile.beliefs of the myth this article corrects, or null. */
  myth: number | null
  /** Index into the author's OWN stories (profile.stories with kind 'own'), or null. */
  story: number | null
  sections: Array<{ heading: string; angle: string }>
  opening: string
  closing: string
  /** Index into the outline's H2s of the one section where the conviction is developed, or null. */
  home?: number | null
  /** Terms of the author's own philosophy, which stay in the opening, the close and the home section. */
  ownTerms?: string[]
}

/** What rests because a recent article of this author already used it (voice/rotation.ts). */
export interface Resting {
  /** Indexes into the author's own stories. */
  stories: Set<number>
  phrases: string[]
}

export const ownStories = (p: VoiceProfile) => p.stories.filter((s) => s.kind === 'own')

/** A few words that name a story without retelling it. */
export const storyLabel = (text: string) => text.replace(/\s+/g, ' ').replace(/^["“”'’\s]+/, '').split(' ').slice(0, 12).join(' ')

/** The numbered material the take step chooses from. A resting story is not listed; the others keep their numbers. */
export function takeMaterial(p: VoiceProfile, rest?: Resting): { beliefs: string; stories: string; habits: string; resting: string; vocabulary: string } {
  const beliefs = p.beliefs.map((b, i) => `B${i + 1} (${b.kind.replace('_', ' ')}): "${b.statement}"`).join('\n') || '(none on record)'
  const own = ownStories(p)
  const stories =
    own
      .map((s, i) => (rest?.stories.has(i) ? '' : `S${i + 1}: "${s.text}"`))
      .filter(Boolean)
      .join('\n') || (own.length ? '(every story of theirs was told in a recent article; none is available for this one)' : '(none on record)')
  // Only stories are the take's to choose; a resting phrase is a matter for the writer (renderTake).
  const restingLines = own.map((s, i) => (rest?.stories.has(i) ? `- the story that begins "${storyLabel(s.text)}…"` : '')).filter(Boolean)
  const habits = [
    p.manner.opening ? `How they begin: ${p.manner.opening.habit}. For example: "${p.manner.opening.example}"` : '',
    p.manner.closing ? `How they end: ${p.manner.closing.habit}. For example: "${p.manner.closing.example}"` : '',
  ]
    .filter(Boolean)
    .join('\n')
  // For naming the terms of their own philosophy: their turns of phrase, their habits with an example each,
  // and a stretch of their own writing. The beliefs alone do not show the vocabulary they write in.
  const sample = p.manner.ownWords.find((w) => w.source === 'sample') ?? [...p.manner.ownWords].sort((a, b) => b.text.length - a.text.length)[0]
  const vocabulary = [
    p.manner.phrases.length ? `Turns of phrase: ${p.manner.phrases.map((x) => `"${x}"`).join(', ')}` : '',
    ...p.manner.habits.map((h) => `- ${h.habit}: "${h.example}"`),
    sample ? `From their own writing: "${sample.text.replace(/\s+/g, ' ').split(' ').slice(0, 700).join(' ')}"` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return { beliefs, stories, habits: habits || '(their material shows no habit for beginning or ending)', resting: restingLines.join('\n') || '(nothing)', vocabulary: vocabulary || '(nothing on record)' }
}

const flatLower = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')

/** Everything on record from the author, for asking whether a term is really theirs. */
function allTheySaid(p: VoiceProfile): string {
  return flatLower([...p.beliefs.map((b) => b.statement), ...p.stories.map((s) => s.text), ...p.manner.ownWords.map((w) => w.text), ...p.manner.phrases, ...p.manner.habits.map((h) => h.example)].join(' '))
}

const num = (v: unknown, prefix: string, max: number): number | null => {
  const m = String(v ?? '').match(new RegExp(`^\\s*${prefix}?\\s*(\\d+)\\s*$`, 'i'))
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= max ? n - 1 : null
}

export function parseTake(raw: string, p: VoiceProfile, h2s: string[], rest?: Resting): Take {
  const empty: Take = { hasPosition: false, position: '', beliefs: [], myth: null, story: null, sections: [], opening: '', closing: '', home: null, ownTerms: [] }
  let j: Record<string, unknown>
  try {
    j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as Record<string, unknown>
  } catch {
    return empty
  }
  const beliefs = [...new Set((Array.isArray(j.beliefs) ? j.beliefs : []).map((b) => num(b, 'B', p.beliefs.length)).filter((n): n is number => n !== null))]
  const myth = num(j.myth, 'B', p.beliefs.length)
  const picked = num(j.story, 'S', ownStories(p).length)
  const story = picked !== null && rest?.stories.has(picked) ? null : picked
  const position = String(j.position ?? '').trim().slice(0, 1200)
  // A position that rests on none of the author's own sentences is the model's view, not the author's.
  const hasPosition = j.has_position !== false && String(j.has_position).toLowerCase() !== 'false' && position.length > 40 && beliefs.length > 0
  const known = new Set(h2s.map((h) => h.toLowerCase().trim()))
  const sections = (Array.isArray(j.sections) ? (j.sections as Array<Record<string, unknown>>) : [])
    .map((s) => ({ heading: String(s.heading ?? '').trim(), angle: String(s.angle ?? '').trim().slice(0, 300) }))
    .filter((s) => s.heading && s.angle && (known.size === 0 || known.has(s.heading.toLowerCase())))
  const homeAt = h2s.findIndex((h) => h.toLowerCase().trim() === String(j.home_section ?? '').toLowerCase().trim())
  // A term counts as the author's own only when it is in what they said themselves.
  const said = allTheySaid(p)
  const ownTerms = [...new Set((Array.isArray(j.own_terms) ? (j.own_terms as unknown[]) : []).map((t) => String(t ?? '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()))]
    .filter((t) => t.length >= 3 && t.length <= 40 && said.includes(t.toLowerCase()))
    .slice(0, 12)
  return {
    hasPosition,
    position: hasPosition ? position : '',
    beliefs: hasPosition ? beliefs : [],
    myth: hasPosition && myth !== null && p.beliefs[myth]?.kind === 'myth' ? myth : null,
    story,
    sections: hasPosition ? sections : [],
    opening: String(j.opening ?? '').trim().slice(0, 300),
    closing: String(j.closing ?? '').trim().slice(0, 300),
    home: hasPosition && homeAt >= 0 ? homeAt : null,
    ownTerms: hasPosition ? ownTerms : [],
  }
}

/** The take as the writer reads it, with the author's own sentences attached by code. */
export function renderTake(t: Take, p: VoiceProfile, h2s: string[] = [], rest?: Resting): string {
  const out: string[] = []
  if (t.hasPosition) {
    out.push(t.position, '', 'It rests on what you have said yourself:')
    for (const i of t.beliefs) out.push(`- "${p.beliefs[i].statement}"`)
    if (t.myth !== null && !t.beliefs.includes(t.myth)) out.push('', `The myth you correct in this article: "${p.beliefs[t.myth].statement}"`)
    else if (t.myth !== null) out.push('', `The myth you correct in this article is the one stated above: "${p.beliefs[t.myth].statement}"`)
    if (t.sections.length) {
      out.push('', 'How you would come at each part:')
      for (const s of t.sections) out.push(`- ${s.heading}: ${s.angle}`)
    }
    const home = t.home !== null && t.home !== undefined ? h2s[t.home] : undefined
    const terms = t.ownTerms ?? []
    if (home || terms.length) {
      out.push(
        '',
        'Where your philosophy lives in this article:',
        `- In the opening, in the close${home ? `, and in the part "${home}"` : ', and in one part of your choosing'}. There you say what you believe, in your own terms.`,
        '- Everywhere else you explain the body and the treatment in the words any clinician would use. Your stance shows in what you choose to stress, not in the vocabulary of your philosophy.',
      )
      if (terms.length) out.push(`- These terms are yours and stay inside those three places: ${terms.map((x) => `"${x}"`).join(', ')}. None of them is ever defined as an established fact. Where you use one, you say what you mean by it.`)
    }
  } else {
    out.push('Your own material says nothing on this topic. The article keeps your manner and your way of explaining. It states no position you have not taken, and it does not borrow a conviction from anyone else.')
  }
  const story = t.story !== null ? ownStories(p)[t.story] : undefined
  if (story) out.push('', 'A story of your own that bears on it (retell it at the length the article needs, add nothing to it):', `"${story.text}"`)
  if (t.opening) out.push('', `How you would open this one: ${t.opening}`)
  if (t.closing) out.push(`How you would close it: ${t.closing}`)
  const own = ownStories(p)
  // A term of the author's philosophy is not a catchphrase: it belongs to what they believe, and does not rest.
  const isOwnTerm = (phrase: string) => (t.ownTerms ?? []).some((term) => flatLower(phrase).includes(flatLower(term)))
  const resting = [
    ...own.map((s, i) => (rest?.stories.has(i) ? `the story that begins "${storyLabel(s.text)}…"` : '')).filter(Boolean),
    ...(rest?.phrases ?? []).filter((x) => !isOwnTerm(x)).map((x) => `the phrase "${x}"`),
  ]
  if (resting.length) out.push('', 'Your recent articles already used these, so they stay out of this one:', ...resting.map((x) => `- ${x}`))
  return out.join('\n').trim()
}

/** The author's convictions on this topic, for the steps that must leave them alone (fact check) or weigh them (compliance). */
export function takeBeliefs(t: Take, p: VoiceProfile): string {
  if (!t.hasPosition) return '(the author has stated no position on this topic)'
  return [t.position, ...t.beliefs.map((i) => `- "${p.beliefs[i].statement}"`)].join('\n')
}
