/**
 * Voice bench 1 (2026-11-27): the six rules that came out of it, each on a
 * sentence taken from the bench articles.
 */
import { describe, it, expect } from 'vitest'
import { contrastShare, hasInterjection, isContrast, joinAfterDelete } from '../../../lib/text/contrast'
import { echoOpeners, echoesHeading, inOwnWords, liftedSentences, openerAcceptable, ownWordsAcceptable, sectionOpeners } from '../own-words'
import { contain, definesTerm, dropFactualOwnTermGlosses, planContainment, termPattern, usesTerm } from '../containment'
import { longestSharedRun, restingFrom } from '../rotation'
import { overLimit, trimHabits } from '../habits'
import { replaceSentences, htmlSentences } from '../sentence-edits'
import { parseTake, renderTake, takeMaterial } from '../take'
import type { VoiceProfile } from '../../../lib/voice/profile'

describe('"this, not that"', () => {
  it('finds the forms that live inside one sentence', () => {
    for (const s of [
      'Sciatica names the pain\'s path, not its source.',
      'Pain is information, not a test of toughness.',
      'They are one part of a plan rather than the whole of it.',
      'It is not a cure but a start.',
      "It isn't the chair; it's the stillness.",
    ])
      expect(isContrast(s), s).toBe(true)
  })
  it('leaves ordinary sentences alone', () => {
    for (const s of ['Stand up every 30 minutes.', 'It helps not only your back but also your hips.', 'I would not stretch a sore nerve.', 'Many people, not least desk workers, feel this.']) expect(isContrast(s), s).toBe(false)
  })
  it('measures an author\'s own rate', () => {
    expect(contrastShare(['One. Two. It is a habit, not a cure. Four.'])).toBeCloseTo(0.25)
    expect(contrastShare([])).toBe(0)
  })
  it('puts the space back when a sentence between two others is removed', () => {
    expect(joinAfterDelete('what it feels like.', 'Some people feel a deep ache.')).toBe('what it feels like. Some people feel a deep ache.')
    expect(joinAfterDelete('<p>', 'Some people')).toBe('<p>Some people')
    expect(joinAfterDelete('It varies.', '</p>')).toBe('It varies.</p>')
  })
})

const FACTS = [
  { text: 'Muscle spasms are likely the most common cause of lower back pain when sitting.', tag: '[Source: Back pain, https://www.health.harvard.edu/x]' },
  { text: 'Pain is often worse in a seated position because the pressure on the nerve root rises by approximately 40%.', tag: '[Source: Disc, https://www.ncbi.nlm.nih.gov/books/NBK560878/]' },
  { text: 'Severe pain and weakness that spreads into one or both legs, making it hard to walk or get out of a chair, indicates a need for emergency medical attention.', tag: '[Source: Back, https://www.hopkinsmedicine.org/x]', safety: true },
  { text: 'I see this most in people who have just started working from home.', tag: '[OBS]' },
]
const DRAFT = `You know the feeling.

## Why Does Sitting in an Office Chair Make Your Lower Back Ache?

Sitting makes your lower back ache because a chair holds your spine in one shape for hours. Muscle spasms are likely the most common cause of lower back pain when sitting. I see this most in people who have just started working from home.

## When Should You Get Checked?

Some symptoms need a hospital today. Severe pain and weakness that spreads into one or both legs, making it hard to walk or get out of a chair, calls for emergency medical attention.

## What Should I Do at Home in the First 48 Hours?

Short, gentle bursts of movement beat bed rest.`

describe('a fact in the source\'s wording', () => {
  it('finds sentences that repeat a source and leaves the author\'s own observation alone', () => {
    const l = liftedSentences(DRAFT, FACTS)
    expect(l.map((x) => x.text)).toEqual([
      'Muscle spasms are likely the most common cause of lower back pain when sitting.',
      'Severe pain and weakness that spreads into one or both legs, making it hard to walk or get out of a chair, calls for emergency medical attention.',
    ])
    expect(l[0].run).toBe(14)
  })
  it('accepts a restatement that keeps the fact and refuses one that changes it', () => {
    const o = 'Pain is often worse in a seated position because the pressure on the nerve root rises by approximately 40%.'
    expect(ownWordsAcceptable(o, 'When you sit, the pressure on that nerve root goes up by about 40%, which is why the pain is often sharper in a chair.', FACTS[1])).toBe(true)
    expect(ownWordsAcceptable(o, 'When you sit, the pressure on that nerve root goes up by about 50%.', FACTS[1])).toBe(false) // a figure changed
    expect(ownWordsAcceptable(o, 'Sitting is harder on you than standing.', FACTS[1])).toBe(false) // the figure and the substance are gone
    expect(ownWordsAcceptable(o, 'Pain is often worse in a seated position because the pressure on the nerve root rises by roughly 40%.', FACTS[1])).toBe(false) // still the source
    expect(ownWordsAcceptable(o, 'Sitting is proven to raise the pressure on that nerve root by about 40%.', FACTS[1])).toBe(false) // stronger
  })
  it('holds a warning sign to more of its substance', () => {
    const o = 'Severe pain and weakness that spreads into one or both legs, making it hard to walk or get out of a chair, calls for emergency medical attention.'
    expect(ownWordsAcceptable(o, 'If severe pain and weakness spread into one leg or both, and walking or getting up from a chair becomes hard, that is an emergency: get medical attention.', FACTS[2])).toBe(true)
    expect(ownWordsAcceptable(o, 'If your legs feel odd, see someone.', FACTS[2])).toBe(false)
  })
})

describe('a section opener that says its heading back', () => {
  it('tells an echo from an answer', () => {
    expect(echoesHeading('Why Does Sitting in an Office Chair Make Your Lower Back Ache?', 'Sitting makes your lower back ache because a chair holds your spine in one shape for hours.')).toBe(true)
    expect(echoesHeading('What Are the Foundations of Biological Recovery?', 'The foundations of biological recovery are sleep, food, water, rest and a settled mind.')).toBe(true)
    expect(echoesHeading('How Do You Build a Weekly Recovery Plan?', 'A weekly recovery plan is a few short resets each day.')).toBe(true)
    expect(echoesHeading('Why Does Sitting All Day Leave My Lower Back Aching?', 'Sitting shifts the work of holding you up from your muscles onto the passive tissues of the lower back.')).toBe(false)
    expect(echoesHeading('What Should I Do at Home in the First 48 Hours?', 'Short, gentle bursts of movement beat bed rest.')).toBe(false)
    expect(echoesHeading('What Does a Five-minute Reset at the Desk Look Like?', 'A five-minute reset reverses the three things a chair does.')).toBe(false)
    expect(echoesHeading('What Should You Look for in a Recovery Partner?', 'A good recovery partner is a guide who shares your philosophy.')).toBe(true)
    expect(echoesHeading('What Does Chiropractic Care Add When the Reset Isn\'t Enough?', 'Chiropractic care adds a hands-on assessment and adjustments aimed at joints that have stopped moving well.')).toBe(true)
  })
  it('finds the first sentence under each H2 and flags only the echoes', () => {
    expect(sectionOpeners(DRAFT).map((o) => o.text.slice(0, 20))).toEqual(['Sitting makes your l', 'Some symptoms need a', 'Short, gentle bursts'])
    expect(echoOpeners(DRAFT).map((o) => o.heading)).toEqual(['Why Does Sitting in an Office Chair Make Your Lower Back Ache?'])
  })
  it('refuses a rewrite that still echoes, opens on a pronoun, asks a question or changes a figure', () => {
    const h = 'Why Does Sitting in an Office Chair Make Your Lower Back Ache?'
    const o = 'Sitting makes your lower back ache because a chair holds your spine in one shape for hours.'
    expect(openerAcceptable(h, o, 'Hours of stillness are what your spine complains about, and a chair is very good at keeping you still.')).toBe(true)
    expect(openerAcceptable(h, o, 'Sitting in an office chair makes the lower back ache through stillness.')).toBe(false)
    expect(openerAcceptable(h, o, 'It comes down to stillness.')).toBe(false)
    expect(openerAcceptable(h, o, 'Ever wondered what eight hours of stillness does?')).toBe(false)
    expect(openerAcceptable(h, o, 'Eight hours of stillness is what your spine complains about.')).toBe(true) // a number word is not a figure
    expect(openerAcceptable(h, o, 'After 8 hours of stillness your spine complains.')).toBe(false)
  })
  it('restates openers and carried-over facts in one pass, and keeps what a rewrite got wrong', async () => {
    const r = await inOwnWords(DRAFT, FACTS, async (s) => {
      if (s.startsWith('Sitting makes')) return { text: 'Hours of stillness are what your spine complains about.', cost: 0.01 }
      if (s.startsWith('Muscle spasms')) return { text: 'Most of the time, when a back hurts in a chair, a muscle in spasm is behind it.', cost: 0.01 }
      return { text: 'See someone if your legs feel odd.', cost: 0.01 } // drops the warning sign's substance
    })
    expect(r.openers).toEqual({ found: 1, fixed: 1 })
    expect(r.lifted).toEqual({ found: 2, fixed: 1 })
    expect(r.text).toContain('Hours of stillness are what your spine complains about. Most of the time, when a back hurts in a chair, a muscle in spasm is behind it. I see this most')
    expect(r.text).toContain('calls for emergency medical attention.')
    expect(r.llmCalls).toBe(3)
  })
})

const HTML = `<p>I believe your Innate knows what to do.</p>
<h2>Why Does Sitting Hurt?</h2>
<p>Stillness is the cause. I believe a subluxation is one of the interferences. Your Educated mind gets in the way.</p>
<h2>What Do I Believe?</h2>
<p>Innate is Boss. A subluxation is a spinal segment that has stopped moving the way it should. The 3 T's matter here.</p>
<h2>What Can You Do?</h2>
<p>Move every 30 minutes. Innate does the rest.</p>
<p>Walk.</p>
<p>Rest.</p>
<p>So trust your Innate. How about you?</p>`
const TERMS = ['Innate', 'Educated mind', 'subluxation', "3 T's"]

describe('belief language is contained', () => {
  it('matches a term in its plural and in the author\'s capitals only', () => {
    expect(termPattern('subluxation').test('Subluxations are common')).toBe(true)
    expect(termPattern('Innate').test('an innate response')).toBe(false)
    expect(termPattern('Innate').test('Thank you, Innate.')).toBe(true)
    expect(usesTerm('The 3 T’s matter.', TERMS)).toBe("3 T's")
    expect(definesTerm('A subluxation is a spinal segment that has stopped moving.', TERMS)).toBe('subluxation')
    expect(definesTerm('I believe a subluxation is one of the interferences.', TERMS)).toBeNull()
  })
  it('allows the opening, the close and the home section, and flags the rest', () => {
    const plan = planContainment(HTML, TERMS, 1, 3)
    expect(plan.home).toBe(1)
    expect(plan.carrying).toBe(8)
    expect(plan.outside.map((x) => x.sentence.text)).toEqual(['I believe a subluxation is one of the interferences.', 'Your Educated mind gets in the way.', 'Innate does the rest.'])
    expect(plan.defined.map((x) => x.sentence.text)).toEqual(['A subluxation is a spinal segment that has stopped moving the way it should.'])
  })
  it('falls back to the section that carries most of the terms when the article left the outline', () => {
    expect(planContainment(HTML, TERMS, 0, 5).home).toBe(1)
  })
  it('moves a sentence to mainstream words, removes one that has nothing left, and has a definition said as the author\'s usage', async () => {
    const r = await contain(HTML, TERMS, 1, 3, async (s, reason) => {
      if (reason.includes('defines')) return { text: 'By a subluxation I mean a spinal segment that has stopped moving the way it should.', cost: 0.01 }
      if (s.startsWith('I believe a subluxation')) return { text: 'I believe a joint that has stopped moving well is one of the things in the way.', cost: 0.01 }
      if (s.startsWith('Your Educated')) return { text: 'Your Educated mind still gets in the way.', cost: 0.01 } // keeps the term: refused
      return { text: '[DELETE]', cost: 0.01 }
    })
    expect(r).toMatchObject({ outside: 3, moved: 1, removed: 1, defined: 1, restated: 1, llmCalls: 4 })
    expect(r.html).toContain('I believe a joint that has stopped moving well is one of the things in the way. Your Educated mind gets in the way.')
    expect(r.html).toContain('<p>Move every 30 minutes.</p>')
    expect(r.html).toContain('By a subluxation I mean a spinal segment')
  })
  it('takes out an explanation that states one of the terms as fact, and keeps the others', () => {
    const html = '<p>One.<span class="term"> A subluxation is a spinal segment that has stopped moving.</span> Two.<span class="term"> By subluxations I mean segments that are not moving.</span><span class="term"> A nerve root is the short branch where a nerve leaves the spinal cord.</span></p>'
    const r = dropFactualOwnTermGlosses(html, TERMS)
    expect(r.dropped).toEqual(['A subluxation is a spinal segment that has stopped moving.'])
    expect(r.html).toBe('<p>One. Two.<span class="term"> By subluxations I mean segments that are not moving.</span><span class="term"> A nerve root is the short branch where a nerve leaves the spinal cord.</span></p>')
  })
  it('removes a sentence cleanly, with its paragraph when nothing else is in it', () => {
    const s = htmlSentences('<p>One. Two. Three.</p><p>Alone.</p>')
    const r = replaceSentences('<p>One. Two. Three.</p><p>Alone.</p>', [{ sentence: s[1], rewrite: '' }, { sentence: s[3], rewrite: '' }])
    expect(r.html).toBe('<p>One. Three.</p>')
  })
})

const profile = {
  version: 1,
  author: { name: 'Mark', practice: 'CCK', industry: 'chiropractic', location: 'Kawana' },
  basis: { spokenWords: 0, sampleWords: 0, derivedAnswers: true },
  identity: { role: 'chiropractor' },
  beliefs: [{ kind: 'stands_for', statement: 'Chiropractors work on the premise that we all have a superpower within which is wanting to express.' }],
  stories: [
    { kind: 'own', text: 'I was sitting in a noisy bar in Vancouver, Canada nursing a beer to last a few hours.' },
    { kind: 'own', text: 'For example, in the 1970s I was in Paris and the Seine river was disgusting. It was unbelievably polluted.' },
    { kind: 'own', text: '“Ouch”, I said as I banged my foot on the corner of the front door the other day.' },
  ],
  manner: { habits: [], phrases: ['song in your heart', 'Innate is Boss'], reader: '', measured: {}, ownWords: [{ source: 'sample', text: 'Innate is Boss. Your Educated mind gets in the way. A subluxation interferes.' }] },
} as unknown as VoiceProfile

describe('rotation', () => {
  it('measures the longest run two texts share', () => {
    expect(longestSharedRun('a b c d e f'.split(' '), 'x b c d e y'.split(' '))).toBe(4)
  })
  it('rests a story a recent article told, by its take or by its text, and a phrase used in the last two', () => {
    const rest = restingFrom(profile, [
      { take: null, text: '<p>With a song in your heart you move better.</p>' },
      { take: { story: 2 } as never, text: 'nothing of note' },
      { take: null, text: 'In the 1970s I was in Paris and the Seine river was disgusting, he said. Innate is Boss.' },
      { take: null, text: 'I was nursing a beer to last me the night.' }, // a few shared words are not the story
    ])
    expect([...rest.stories].sort()).toEqual([1, 2])
    expect(rest.phrases).toEqual(['song in your heart'])
  })
  it('does not offer a resting story to the take, refuses it if chosen anyway, and tells the writer what rests', () => {
    const rest = { stories: new Set([1]), phrases: ['Innate is Boss', 'song in your heart'] }
    const m = takeMaterial(profile, rest)
    expect(m.stories).toContain('S1: "I was sitting')
    expect(m.stories).toContain('S3: "“Ouch”')
    expect(m.stories).not.toContain('Seine')
    expect(m.resting).toContain('the story that begins "For example, in the 1970s I was in Paris')
    expect(m.resting).not.toContain('phrase')
    const h2s = ['Why sitting hurts', 'What I believe', 'What to do']
    const raw = JSON.stringify({ has_position: true, position: 'I believe your body is not broken and that it knows what to do once the irritation eases.', beliefs: ['B1'], story: 'S2', home_section: 'What I believe', own_terms: ['Innate', 'Educated mind', 'biomechanics', 'subluxation'], sections: [], opening: 'x', closing: 'y' })
    const t = parseTake(raw, profile, h2s, rest)
    expect(t.story).toBeNull()
    expect(t.home).toBe(1)
    expect(t.ownTerms).toEqual(['Innate', 'Educated mind', 'subluxation']) // "biomechanics" is not in anything the author said
    const text = renderTake(t, profile, h2s, rest)
    expect(text).toContain('and in the part "What I believe"')
    expect(text).toContain('"Innate", "Educated mind", "subluxation"')
    expect(text).toContain('Your recent articles already used these')
    expect(text).toContain('- the phrase "song in your heart"')
    expect(text).not.toContain('the phrase "Innate is Boss"') // a term of the philosophy does not rest
  })
})

describe('habits held to the author\'s rate', () => {
  const limits = { questionShare: 0.5, exclaimShare: 0.5, capsPer100: 0, contrastShare: 0.02 }
  const html = '<h2>A?</h2><p>It is a sign, not a diagnosis. Hmmmm, a bit of pain is normal. Hmmmm! Pain is information, not a test. We move rather than rest. It names the path, not the source. Plain one. Hmmmm, one more.</p>'
  it('counts contrasts and interjections', () => {
    const c = overLimit(html, limits)
    expect(c.find((x) => x.habit === 'contrast')).toMatchObject({ found: 4, allowed: 2 })
    expect(c.find((x) => x.habit === 'interjection')).toMatchObject({ found: 3, allowed: 1 })
  })
  it('restates the surplus and drops a filler that stands alone', async () => {
    const r = await trimHabits(html, limits, async (s) => {
      if (/^Hmmmm!$/.test(s)) return { text: '[DELETE]', cost: 0 }
      if (/^Hmmmm,/.test(s)) return { text: s.replace(/^Hmmmm,\s*/, '').replace(/^./, (c) => c.toUpperCase()), cost: 0 }
      return { text: s.replace(/, not .*$/, '.').replace(/ rather than .*$/, '.'), cost: 0 }
    })
    expect(r.counts.find((x) => x.habit === 'contrast')).toMatchObject({ surplus: 2, fixed: 2 })
    expect(r.counts.find((x) => x.habit === 'interjection')).toMatchObject({ surplus: 2, fixed: 2 })
    expect(hasInterjection('Hmmmm, a bit of pain is normal.')).toBe(true)
    expect(r.html.match(/Hmmmm/g)).toHaveLength(1)
  })
})
