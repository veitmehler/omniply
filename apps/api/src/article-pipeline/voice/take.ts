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
}

export const ownStories = (p: VoiceProfile) => p.stories.filter((s) => s.kind === 'own')

/** The numbered material the take step chooses from. */
export function takeMaterial(p: VoiceProfile): { beliefs: string; stories: string; habits: string } {
  const beliefs = p.beliefs.map((b, i) => `B${i + 1} (${b.kind.replace('_', ' ')}): "${b.statement}"`).join('\n') || '(none on record)'
  const stories = ownStories(p).map((s, i) => `S${i + 1}: "${s.text}"`).join('\n') || '(none on record)'
  const habits = [
    p.manner.opening ? `How they begin: ${p.manner.opening.habit}. For example: "${p.manner.opening.example}"` : '',
    p.manner.closing ? `How they end: ${p.manner.closing.habit}. For example: "${p.manner.closing.example}"` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return { beliefs, stories, habits: habits || '(their material shows no habit for beginning or ending)' }
}

const num = (v: unknown, prefix: string, max: number): number | null => {
  const m = String(v ?? '').match(new RegExp(`^\\s*${prefix}?\\s*(\\d+)\\s*$`, 'i'))
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= max ? n - 1 : null
}

export function parseTake(raw: string, p: VoiceProfile, h2s: string[]): Take {
  const empty: Take = { hasPosition: false, position: '', beliefs: [], myth: null, story: null, sections: [], opening: '', closing: '' }
  let j: Record<string, unknown>
  try {
    j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as Record<string, unknown>
  } catch {
    return empty
  }
  const beliefs = [...new Set((Array.isArray(j.beliefs) ? j.beliefs : []).map((b) => num(b, 'B', p.beliefs.length)).filter((n): n is number => n !== null))]
  const myth = num(j.myth, 'B', p.beliefs.length)
  const story = num(j.story, 'S', ownStories(p).length)
  const position = String(j.position ?? '').trim().slice(0, 1200)
  // A position that rests on none of the author's own sentences is the model's view, not the author's.
  const hasPosition = j.has_position !== false && String(j.has_position).toLowerCase() !== 'false' && position.length > 40 && beliefs.length > 0
  const known = new Set(h2s.map((h) => h.toLowerCase().trim()))
  const sections = (Array.isArray(j.sections) ? (j.sections as Array<Record<string, unknown>>) : [])
    .map((s) => ({ heading: String(s.heading ?? '').trim(), angle: String(s.angle ?? '').trim().slice(0, 300) }))
    .filter((s) => s.heading && s.angle && (known.size === 0 || known.has(s.heading.toLowerCase())))
  return {
    hasPosition,
    position: hasPosition ? position : '',
    beliefs: hasPosition ? beliefs : [],
    myth: hasPosition && myth !== null && p.beliefs[myth]?.kind === 'myth' ? myth : null,
    story,
    sections: hasPosition ? sections : [],
    opening: String(j.opening ?? '').trim().slice(0, 300),
    closing: String(j.closing ?? '').trim().slice(0, 300),
  }
}

/** The take as the writer reads it, with the author's own sentences attached by code. */
export function renderTake(t: Take, p: VoiceProfile): string {
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
  } else {
    out.push('Your own material says nothing on this topic. The article keeps your manner and your way of explaining. It states no position you have not taken, and it does not borrow a conviction from anyone else.')
  }
  const story = t.story !== null ? ownStories(p)[t.story] : undefined
  if (story) out.push('', 'A story of your own that bears on it (retell it at the length the article needs, add nothing to it):', `"${story.text}"`)
  if (t.opening) out.push('', `How you would open this one: ${t.opening}`)
  if (t.closing) out.push(`How you would close it: ${t.closing}`)
  return out.join('\n').trim()
}

/** The author's convictions on this topic, for the steps that must leave them alone (fact check) or weigh them (compliance). */
export function takeBeliefs(t: Take, p: VoiceProfile): string {
  if (!t.hasPosition) return '(the author has stated no position on this topic)'
  return [t.position, ...t.beliefs.map((i) => `- "${p.beliefs[i].statement}"`)].join('\n')
}
