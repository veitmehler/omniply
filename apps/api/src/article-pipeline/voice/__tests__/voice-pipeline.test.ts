import { describe, it, expect } from 'vitest'
import { coreStats, factsForSelector, hasFigure, outlineH2s, parseResearchFacts, parseSelection, renderCore, restatesFact, selectCore, siteOf } from '../facts'
import { ownStories, parseTake, renderTake, takeBeliefs, takeMaterial } from '../take'
import { markdownToHtml } from '../markdown'
import { applyFixes, draftSentences, fixAcceptable, fixRequests, locateClaim, parseFactCheck, parseFixes } from '../fact-fix'
import { editAcceptable, findQuoted, htmlSentences, replaceSentences } from '../sentence-edits'
import { applyBeliefFindings, articleForCheck, parseBeliefFindings } from '../belief-check'
import { overLimit, trimHabits } from '../habits'
import type { VoiceProfile } from '../../../lib/voice/profile'

const STEP7 = `**Why does my lumbar hurt when I sit?**
1. Weakened abdominal muscles fail to support the spine correctly, which can result in back strains. [Source: Lower Back Pain, https://my.clevelandclinic.org/health/diseases/7936-lower-back-pain]
2. Low back pain that gets worse with sitting may indicate a herniated lumbar disc. [Source: Lower Back Pain in depth, https://www.hss.edu/health-library/lower-back-pain]
3. Seek emergency care for back pain with loss of bladder or bowel control. [Source: Back pain, https://www.mayoclinic.org/diseases-conditions/back-pain/symptoms-causes/syc-20369906]`
const STEP8 = `**H2: The Biomechanics of Sitting**
1. Sitting slouched puts about 40% more pressure on the lumbar discs than standing. [Source: Disc pressure, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/111/]
2. Low back pain that gets worse with sitting may indicate a herniated lumbar disc. [Source: Lower Back Pain in depth, https://www.hss.edu/health-library/lower-back-pain]
3. Prolonged sitting in non-neutral positions contributes to musculoskeletal issues. [Source: Telework, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/37465175/]
4. Teleworkers most frequently report discomfort in the lower back area. [Source: Telework, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/37465175/]
5. Screens placed too low are linked to neck and back discomfort. [Source: Telework, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/37465175/]
6. Non-ergonomic chairs are linked to physical pain. [Source: Telework, pubmed.ncbi.nlm.nih.gov, https://pubmed.ncbi.nlm.nih.gov/37465175/]
7. I see this most in people who have just started working from home. [OBS]
**H2: Five-Minute Resets That Help**
1. Taking breaks to stretch or walk is recommended to reduce pressure from sitting. [Source: Lower Back Pain in depth, https://www.hss.edu/health-library/lower-back-pain]
2. Walking for 5 minutes every 30 minutes lowered reported stiffness. (One study, in office workers.) [Source: Breaks, https://health.clevelandclinic.org/breaks]`
const OUTLINE = `# ARTICLE OUTLINE: Sitting
## H1: Why You Ache
## H2: The Biomechanics of Sitting
### H3: Disc pressure
## H2: Five-Minute Resets That Help
## H2: When to Get Checked`

describe('core facts', () => {
  const facts = parseResearchFacts(STEP7, STEP8)
  const h2s = outlineH2s(OUTLINE)
  it('reads both research outputs into one numbered list without repeats', () => {
    expect(facts).toHaveLength(11)
    expect(facts.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(facts[3]).toMatchObject({ host: 'pubmed.ncbi.nlm.nih.gov', unit: 'The Biomechanics of Sitting', figure: true })
    expect(facts[2].safety).toBe(true)
    expect(facts.find((f) => f.text.startsWith('I see this most'))?.tag).toBe('[OBS]')
    expect(h2s).toEqual(['The Biomechanics of Sitting', 'Five-Minute Resets That Help', 'When to Get Checked'])
  })
  it('tells a figure from the digits of a name', () => {
    expect(hasFigure('about 40% more pressure')).toBe(true)
    expect(hasFigure('for 5 minutes every 30 minutes')).toBe(true)
    expect(hasFigure('the L5 vertebra and vitamin B12')).toBe(false)
    expect(hasFigure('one in four adults')).toBe(true)
  })
  it('counts the subdomains of a site together', () => {
    expect(siteOf('my.clevelandclinic.org')).toBe('clevelandclinic.org')
    expect(siteOf('health.clevelandclinic.org')).toBe('clevelandclinic.org')
    expect(siteOf('www.nhs.uk')).toBe('nhs.uk')
    expect(siteOf('healthdirect.gov.au')).toBe('healthdirect.gov.au')
  })
  it('shows the selector every fact with its number', () => {
    const text = factsForSelector(facts)
    expect(text).toContain('[The Biomechanics of Sitting]')
    expect(text).toContain('4. Sitting slouched puts about 40% more pressure')
    expect(text).toContain("(the author's own observation)")
  })
  it('keeps the selection inside its limits and always takes the warning sign', () => {
    const picks = parseSelection(JSON.stringify({ sections: [{ heading: 'The Biomechanics of Sitting', facts: [4, 5, 6, 7, 8, 9, 99, 4] }, { heading: 'Five-Minute Resets That Help', facts: [10, 11] }] }))
    const core = selectCore(facts, picks, h2s)
    const bio = core.sections[0].facts.map((f) => f.id)
    expect(bio).toHaveLength(4) // the ceiling per section
    expect(new Set(bio).size).toBe(4)
    expect(core.sections[1].facts.map((f) => f.id)).toEqual([10, 11])
    expect(core.safety.map((f) => f.id)).toEqual([3])
    expect(core.reserve.map((f) => f.id)).not.toContain(3)
    expect(coreStats(core).core + coreStats(core).reserve).toBe(facts.length)
  })
  it('caps one site, so a single page cannot fill the article', () => {
    const picks = [{ heading: 'The Biomechanics of Sitting', facts: [5, 6, 7, 8] }, { heading: 'Five-Minute Resets That Help', facts: [4] }]
    const core = selectCore(facts, picks, h2s, { perSection: 4, perHost: 2, total: 26, extraSafety: 4, floorPerSection: 1 })
    const pubmed = [...core.sections.flatMap((s) => s.facts)].filter((f) => f.host === 'pubmed.ncbi.nlm.nih.gov')
    expect(pubmed).toHaveLength(2)
  })
  it('still gives a usable core when the selector returns nothing', () => {
    const core = selectCore(facts, parseSelection('sorry'), h2s)
    expect(core.sections[0].facts.length).toBeGreaterThan(0)
    expect(core.sections[1].facts.length).toBeGreaterThan(0)
    expect(core.safety.length + core.sections.flatMap((s) => s.facts).filter((f) => f.safety).length).toBe(1)
  })
  it('renders the core by section with the source tags the linker needs', () => {
    const core = selectCore(facts, [{ heading: 'Five-Minute Resets That Help', facts: [11] }], h2s)
    const text = renderCore(core)
    expect(text).toContain('**Five-Minute Resets That Help**')
    expect(text).toContain('(One study, in office workers.) [Source: Breaks, https://health.clevelandclinic.org/breaks]')
    expect(text).toContain('Warning signs and safety points')
  })
})

const profile = {
  version: 1,
  author: { name: 'Ana Ruiz', practice: 'Tide Clinic', industry: 'Wellness', location: 'Lisbon' },
  basis: { spokenWords: 500, sampleWords: 500, derivedAnswers: false, quotesDropped: 0, dropped: [] },
  identity: { role: 'Founder', stated: null, does: [], teamDoes: [] },
  beliefs: [
    { kind: 'stands_for', statement: 'Rest is the work.', topics: ['rest'] },
    { kind: 'myth', statement: 'People think one session will fix them.', topics: ['quick fix'] },
    { kind: 'fights', statement: 'Influencers sell powders they do not understand.', topics: ['supplements'] },
  ],
  stories: [
    { kind: 'client', text: 'One client, a runner, came in sure he needed surgery.', topics: [] },
    { kind: 'own', text: 'My grandmother never rested a day in her life.', topics: ['rest'] },
  ],
  manner: { habits: [], phrases: [], opening: { habit: 'Opens on a small scene from daily life', example: 'Ouch, I said.' }, closing: null, reader: '', measured: { answers: null, sample: null }, ownWords: [] },
} as unknown as VoiceProfile

describe('the take', () => {
  const h2s = ['Why Rest Matters', 'What To Do']
  it('offers only the author\'s own stories, never a client\'s', () => {
    expect(ownStories(profile)).toHaveLength(1)
    const m = takeMaterial(profile)
    expect(m.stories).toContain('S1: "My grandmother')
    expect(m.stories).not.toContain('runner')
    expect(m.beliefs).toContain('B2 (myth): "People think one session will fix them."')
  })
  it('attaches the author\'s own sentences to the position by number', () => {
    const t = parseTake(JSON.stringify({ has_position: true, position: 'I think recovery is mostly rest, and most people fight that idea for weeks before they give in.', beliefs: ['B1', 2, 'B9'], myth: 'B2', story: 'S1', sections: [{ heading: 'Why Rest Matters', angle: 'Start from the myth.' }, { heading: 'Made Up', angle: 'x' }], opening: 'Open on the kettle.', closing: 'End on a question.' }), profile, h2s)
    expect(t).toMatchObject({ hasPosition: true, beliefs: [0, 1], myth: 1, story: 0 })
    expect(t.sections).toHaveLength(1)
    const text = renderTake(t, profile)
    expect(text).toContain('- "Rest is the work."')
    expect(text).toContain('The myth you correct in this article is the one stated above')
    expect(text).toContain('"My grandmother never rested a day in her life."')
    expect(text).toContain('How you would open this one: Open on the kettle.')
    expect(takeBeliefs(t, profile)).toContain('People think one session will fix them.')
  })
  it('invents no position when the author\'s material has nothing on the topic', () => {
    for (const raw of [JSON.stringify({ has_position: false, position: '', beliefs: [] }), JSON.stringify({ has_position: true, position: 'A long enough position that rests on nothing the author ever said about it.', beliefs: [] }), 'not json']) {
      const t = parseTake(raw, profile, h2s)
      expect(t.hasPosition).toBe(false)
      expect(renderTake(t, profile)).toContain('states no position you have not taken')
    }
  })
  it('does not accept a belief of another kind as the myth', () => {
    expect(parseTake(JSON.stringify({ position: 'A long enough position that rests on the first belief of the author.', beliefs: ['B1'], myth: 'B1' }), profile, h2s).myth).toBeNull()
  })
})

describe('markdown to body HTML', () => {
  it('converts what the writer may produce and leaves the wording alone', () => {
    const html = markdownToHtml('First paragraph with **bold** and *soft* words,\nwrapped over two lines.\n\n## Why Does It Hurt?\n\nIt hurts & it lasts.\n\n- one thing\n- another *thing*\n\n### A detail\n\n1. first\n2. second\n\n# Not a title\n')
    expect(html).toBe(
      ['<p>First paragraph with <strong>bold</strong> and <em>soft</em> words, wrapped over two lines.</p>', '<h2>Why Does It Hurt?</h2>', '<p>It hurts &amp; it lasts.</p>', '<ul><li>one thing</li><li>another <em>thing</em></li></ul>', '<h3>A detail</h3>', '<ol><li>first</li><li>second</li></ol>', '<h2>Not a title</h2>'].join('\n'),
    )
  })
  it('does not mistake a multiplication or a stray star for emphasis', () => {
    expect(markdownToHtml('Take 2 * 3 breaths and rest.')).toBe('<p>Take 2 * 3 breaths and rest.</p>')
  })
})

const DRAFT = `I see this every week. Sitting slouched puts 185% more pressure on the discs than standing. Most people never notice until the afternoon.

## What To Do

Get up every 30 minutes. Walking cures stiffness for everyone who tries it.

- Stand when the phone rings.
- Walk to the kettle.`
const FACT_CHECK = `Here is the report.

- Fact or Claim: "Sitting slouched puts 185% more pressure on the discs than standing."
- Verdict: Partly true.
- Explanation: Verified Fact 4 gives about 40%, not 185%.

- Fact or Claim: "Get up every 30 minutes."
- Verdict: True.
- Explanation: Matches Verified Fact 10.

- **Fact or Claim:** Walking cures stiffness for everyone
- **Verdict:** False
- **Explanation:** No source supports a cure; one study in office workers saw lower stiffness.

- Fact or Claim: "The moon is closer in winter."
- Verdict: False.
- Explanation: Not in the article's sources.`

describe('fact correction of flagged sentences only', () => {
  const claims = parseFactCheck(FACT_CHECK)
  it('reads the verdicts', () => {
    expect(claims.map((c) => c.ok)).toEqual([false, true, false, false])
    expect(claims[2].claim).toBe('Walking cures stiffness for everyone')
  })
  it('finds the sentence a claim refers to, and says when it cannot', () => {
    expect(locateClaim(DRAFT, claims[0].claim)?.text).toBe('Sitting slouched puts 185% more pressure on the discs than standing.')
    expect(locateClaim(DRAFT, claims[2].claim)?.text).toBe('Walking cures stiffness for everyone who tries it.')
    const { requests, notFound } = fixRequests(DRAFT, claims)
    expect(requests).toHaveLength(2)
    expect(notFound.map((c) => c.claim)).toEqual(['The moon is closer in winter.'])
    expect(requests[0].paragraph).toContain('I see this every week.')
    expect(draftSentences(DRAFT).some((s) => s.text.startsWith('##'))).toBe(false)
  })
  it('accepts a corrected figure only when the fact check gave it', () => {
    const o = 'Sitting slouched puts 185% more pressure on the discs than standing.'
    expect(fixAcceptable(o, 'Sitting slouched puts about 40% more pressure on the discs than standing.', 'Verified Fact 4 gives about 40%, not 185%.')).toBe(true)
    expect(fixAcceptable(o, 'Sitting slouched puts 90% more pressure on the discs than standing.', 'Verified Fact 4 gives about 40%, not 185%.')).toBe(false)
    expect(fixAcceptable(o, 'According to the source, sitting slouched loads the discs more.', 'x')).toBe(false)
    expect(fixAcceptable(o, 'Sitting slouched is proven to load the discs more.', 'x')).toBe(false)
    expect(fixAcceptable(o, '[DELETE]', 'x')).toBe(true)
  })
  it('changes the flagged sentences and nothing else', () => {
    const { requests } = fixRequests(DRAFT, claims)
    const fixes = parseFixes(JSON.stringify({ fixes: [{ id: 1, rewrite: 'Sitting slouched puts about 40% more pressure on the discs than standing.' }, { id: 2, rewrite: 'In one group of office workers, walking breaks went with less stiffness.' }] }))
    const r = applyFixes(DRAFT, requests, fixes)
    expect(r).toMatchObject({ applied: 2, deleted: 0, refused: 0 })
    expect(r.text).toContain('I see this every week. Sitting slouched puts about 40% more pressure on the discs than standing. Most people never notice until the afternoon.')
    expect(r.text).toContain('Get up every 30 minutes. In one group of office workers, walking breaks went with less stiffness.')
    expect(r.text).toContain('- Walk to the kettle.')
  })
  it('refuses a rewrite that brings in a new figure and keeps the original', () => {
    const { requests } = fixRequests(DRAFT, claims)
    const r = applyFixes(DRAFT, requests, new Map([[1, 'Sitting slouched puts 300% more pressure on the discs.']]))
    expect(r).toMatchObject({ applied: 0, refused: 1 })
    expect(r.text).toBe(DRAFT)
  })
})

const HTML = `<p>I believe the body heals itself. Chiropractic will cure your headaches for good!</p>
<h2>What Do I Check First?</h2>
<p>Is it the chair? Often it is. Do you slouch? Most of us do. Is that a problem? Sometimes. Does it hurt? Then come in!</p>
<p>About one in four adults has back pain, as <a href="https://x.org/y">one large survey found</a>. Can you guess why?</p>
<ul><li>Stand up <strong>every</strong> half hour.</li></ul>`

describe('sentence edits on body HTML', () => {
  const s = htmlSentences(HTML)
  it('lists the sentences of paragraphs and list items, with links and section openers marked', () => {
    expect(s.map((x) => x.text)).toContain('Chiropractic will cure your headaches for good!')
    expect(s.find((x) => x.text.startsWith('About one in four'))?.hasLink).toBe(true)
    expect(s.find((x) => x.text === 'Is it the chair?')?.opensSection).toBe(true)
    expect(s.find((x) => x.text === 'Often it is.')?.opensSection).toBe(false)
    expect(s.some((x) => x.text.includes('What Do I Check First'))).toBe(false)
    expect(s.find((x) => x.text.startsWith('Stand up'))?.text).toBe('Stand up every half hour.')
  })
  it('replaces a sentence in place and never one with a link', () => {
    const cure = findQuoted(s, 'chiropractic will cure your headaches for good')!
    const linked = s.find((x) => x.hasLink)!
    const r = replaceSentences(HTML, [{ sentence: cure, rewrite: 'In my experience many people with headaches feel better with care.' }, { sentence: linked, rewrite: 'Back pain is common.' }])
    expect(r).toMatchObject({ applied: 1, skipped: 1 })
    expect(r.html).toContain('<p>I believe the body heals itself. In my experience many people with headaches feel better with care.</p>')
    expect(r.html).toContain('<a href="https://x.org/y">one large survey found</a>')
  })
  it('refuses an edit that adds a figure or a stronger claim', () => {
    expect(editAcceptable('It often helps.', 'It helps 9 in 10 people.')).toBe(false)
    expect(editAcceptable('It often helps.', 'It is proven to help.')).toBe(false)
    expect(editAcceptable('It often helps.', 'In my experience it often helps.')).toBe(true)
  })
})

describe('belief compliance check', () => {
  it('acts only on a sentence it finds word for word, with a rewrite that adds nothing', () => {
    const findings = parseBeliefFindings(
      JSON.stringify({
        findings: [
          { sentence: 'Chiropractic will cure your headaches for good!', problem: 'Promises an outcome.', rewrite: 'I have seen many people with headaches do well under chiropractic care.' },
          { sentence: 'The body always heals itself.', problem: 'Absolute.', rewrite: 'The body often heals itself.' },
          { sentence: 'I believe the body heals itself.', problem: 'none', rewrite: 'It is proven that the body heals itself.' },
        ],
      }),
    )
    const r = applyBeliefFindings(HTML, findings)
    expect(r).toMatchObject({ found: 3, applied: 1 })
    expect(r.html).toContain('I believe the body heals itself. I have seen many people with headaches do well under chiropractic care.')
    expect(r.open.map((o) => o.why)).toEqual(['the sentence was not found word for word in the article', 'the rewrite adds a figure, a link or a stronger claim, or is much longer'])
    expect(r.changes[0].before).toBe('Chiropractic will cure your headaches for good!')
  })
  it('never turns a restated finding into a first-person claim, and still lets an unmarked conviction gain its "I"', () => {
    const html = '<p>Spinal manipulation improves joint mobility and muscle flexibility in everyone. Chiropractic will fix your posture for life.</p>'
    const isFinding = (s: string) => restatesFact(s, [{ text: 'Spinal manipulation improves joint mobility, muscle flexibility and coordination.' }])
    const findings = [
      { sentence: 'Spinal manipulation improves joint mobility and muscle flexibility in everyone.', problem: 'absolute', rewrite: 'We find spinal manipulation usually improves joint mobility and muscle flexibility.' },
      { sentence: 'Chiropractic will fix your posture for life.', problem: 'promise', rewrite: 'I have seen posture change for the better under chiropractic care.' },
    ]
    const r = applyBeliefFindings(html, findings, { isFinding })
    expect(r.applied).toBe(1)
    expect(r.open[0].why).toBe('the rewrite turns a restated finding into a first-person claim')
    expect(r.html).toContain('Spinal manipulation improves joint mobility and muscle flexibility in everyone. I have seen posture change')
    const general = applyBeliefFindings(html, [{ ...findings[0], rewrite: 'Spinal manipulation often improves joint mobility and muscle flexibility.' }], { isFinding })
    expect(general.applied).toBe(1)
  })
  it('reads the article as plain text under its headings', () => {
    expect(articleForCheck(HTML)).toContain('## What Do I Check First?')
    expect(articleForCheck(HTML)).not.toContain('<')
  })
})

describe('advice against a medication', () => {
  const html = '<h2>What Helps?</h2><p>Rest briefly. Ibuprofen should not be used in the first 48 hours after an initial injury, as it may delay healing. Spinal manipulation improves joint mobility.</p>'
  const isFinding = () => true
  it('is softened even where the sentence restates research', () => {
    const r = applyBeliefFindings(html, [{ sentence: 'Ibuprofen should not be used in the first 48 hours after an initial injury, as it may delay healing.', problem: 'Tells the reader to avoid a medication', rewrite: 'Whether an anti-inflammatory suits you in the first 48 hours is a question I would put to your GP or pharmacist.' }], { isFinding })
    expect(r.applied).toBe(1)
    expect(r.html).toContain('a question I would put to your GP or pharmacist')
  })
  it('while a restated finding still does not become a first-person claim for any other reason', () => {
    const r = applyBeliefFindings(html, [{ sentence: 'Spinal manipulation improves joint mobility.', problem: 'States a treatment outcome as an absolute fact', rewrite: 'We find spinal manipulation usually improves joint mobility.' }], { isFinding })
    expect(r.applied).toBe(0)
    expect(r.open[0].why).toContain('first-person')
  })
})

describe('wording limits relative to the author', () => {
  const rewriter = async (sentence: string) => ({ text: sentence.replace(/\?$/, '.').replace(/!$/, '.'), cost: 0.001 })
  it('counts a habit against the author\'s own rate and leaves the section opener and linked sentences alone', () => {
    const counts = overLimit(HTML, { questionShare: 0.04, exclaimShare: 0.004, capsPer100: 0, contrastShare: 0.5 })
    const q = counts.find((c) => c.habit === 'question')!
    expect(q.found).toBe(5)
    expect(q.allowed).toBe(2)
    expect(q.surplus.map((s) => s.text)).not.toContain('Is it the chair?')
    expect(q.surplus.map((s) => s.text)).not.toContain('Can you guess why?')
    expect(q.surplus).toHaveLength(3)
  })
  it('trims the surplus for an author who rarely asks, and nothing for one who asks often', async () => {
    const rare = await trimHabits(HTML, { questionShare: 0.04, exclaimShare: 0.004, capsPer100: 0, contrastShare: 0.5 }, rewriter)
    expect(rare.html).toContain('Is it the chair? Often it is.')
    expect(rare.html.match(/\?/g)!.length).toBeLessThan(HTML.match(/\?/g)!.length)
    expect(rare.counts.find((c) => c.habit === 'question')).toMatchObject({ found: 5, surplus: 3, fixed: 3 })
    const asker = await trimHabits(HTML, { questionShare: 0.5, exclaimShare: 0.3, capsPer100: 0, contrastShare: 0.5 }, rewriter)
    expect(asker.html).toBe(HTML)
    expect(asker.llmCalls).toBe(0)
  })
  it('keeps the sentence when the rewrite still shows the habit', async () => {
    const stubborn = await trimHabits(HTML, { questionShare: 0.04, exclaimShare: 0.004, capsPer100: 0, contrastShare: 0.5 }, async (s) => ({ text: s, cost: 0 }))
    expect(stubborn.html).toBe(HTML)
  })
})
