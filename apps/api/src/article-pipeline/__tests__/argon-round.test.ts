import { beforeAll, describe, expect, it } from 'vitest'
import { isInterrogativeHeading, normalizeH2Questions } from '../approval-service'
import { anchorFactSources } from '../source-verify'
import { rankCitationPool } from '../citation-policy'
import { glossGateReason, seedExplainedTerms, glossSkipReason, GLOSS_CONSEQUENCE, GLOSS_EXAMPLE, GLOSS_PLAIN, GLOSS_APPOSITION } from '../enrichment/plain-language'
import { resolve } from 'path'

// Dynamic import by variable path: tsc (rootDir = apps/api/src) does not follow it, vitest resolves it at run time.
const DB_PRISMA = resolve(__dirname, '../../../../../packages/db/prisma')
let WRITER_SYSTEM_PROMPT = ''
let WRITER_USER_PROMPT = ''
let RESEARCH_SYSTEM_PROMPT = ''
beforeAll(async () => {
  const defaults = (await import(/* @vite-ignore */ `${DB_PRISMA}/article-writer-prompts.ts`)) as Record<string, string>
  ;({ WRITER_SYSTEM_PROMPT, WRITER_USER_PROMPT, RESEARCH_SYSTEM_PROMPT } = defaults)
})
import { looksLikeTableRow, parseFacts, extractionPrompt } from '../research-retrieval'

// Argon (Gemini) round on Dasha's articles, 2026-11-12.
describe('question marks only on headings with interrogative form', () => {
  it('leaves statements that merely start with a wh-word alone', () => {
    for (const h of ['What a Guide-led Assessment Measures', 'Why the Same Week Costs Different People Different Amounts', 'What a Steady Routine Costs and What It Asks of You', 'How Recovery Compounds', 'How Long Adaptation Takes', 'How Often to Use Recovery Tools']) {
      expect(isInterrogativeHeading(h), h).toBe(false)
    }
    const html = '<h2>What a Guide-led Assessment Measures</h2>'
    expect(normalizeH2Questions(html)).toBe(html)
  })
  it('reads a wh-word contraction as a question (ARGON bench 2026-11-13)', () => {
    for (const h of ["What's a Quick Five-minute Routine for a Stiff Back After Sitting", "Where's the Line Between Sore and Injured", "How's the First Session Different", 'How Much Pressure Is Right', 'How Long Does Soreness Last']) {
      expect(isInterrogativeHeading(h), h).toBe(true)
    }
    expect(normalizeH2Questions("<h2>What's a Quick Routine</h2>")).toBe("<h2>What's a Quick Routine?</h2>")
  })
  it('recognises real questions and appends the mark', () => {
    for (const h of ['What Does a Guide-led Assessment Measure', "Why Haven't the Obvious Fixes Worked", 'How Fast Does a New Inquiry Need to Be Answered', 'What Counts as Overtraining', 'Can I Run This Myself', 'Which Treatments Are Worth the Money', 'How Long Does Soreness Last']) {
      expect(isInterrogativeHeading(h), h).toBe(true)
    }
    expect(normalizeH2Questions('<h2 id="x">What Does a Retainer Cost</h2>')).toBe('<h2 id="x">What Does a Retainer Cost?</h2>')
    expect(normalizeH2Questions('<h2>What Does a Retainer Cost?</h2>')).toBe('<h2>What Does a Retainer Cost?</h2>')
  })
})

describe('fact anchor keeps a decimal figure whole', () => {
  it('links the whole sentence around "47.2%"', () => {
    const html = '<p>Rules vary by country. About 47.2% of insurers there require prior authorization for the first course. That is the US picture.</p>'
    const { html: out, placed } = anchorFactSources(html, [
      { fact: 'About 47.2% of insurers require prior authorization for the first course', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 't', status: 'retrieved' } as never,
    ])
    expect(placed).toEqual(['https://pubmed.ncbi.nlm.nih.gov/1/'])
    expect(out).toMatch(/<a [^>]*>About 47\.2% of insurers there require prior authorization for the first course<\/a>\./)
    expect(out).not.toMatch(/47\.<a/)
  })
})

describe('retrieval drops facts outside the reader\'s setting and table rows', () => {
  it('filters applies:false and table-shaped quotes', () => {
    const raw = JSON.stringify([
      { fact: 'Secondary traumatic stress symptoms rise with allostatic load in registered nurses', quote: 'Among registered nurses, higher allostatic load predicted secondary traumatic stress symptoms over twelve months.', setting: 'registered nurses, hospital', applies: false },
      { fact: 'Light bench press at 6 and 30 hours after training restores pectoral thickness faster', quote: 'High VOL BP (8x10x70%1RM), PR or AR (BP, 5x10x10%1RM) 6- & 30-h post; pec MT restored 24 h', setting: 'trained men', applies: true },
      { fact: 'Muscle soreness after unaccustomed exercise peaks between 12 and 48 hours and can last up to 14 days', quote: 'Symptoms of exercise-induced muscle damage typically peak between 12 and 48 hours after exercise and may persist for up to 14 days.', setting: 'healthy adults', applies: true },
    ])
    const facts = parseFacts(raw)
    expect(facts).toHaveLength(1)
    expect(facts[0].fact).toMatch(/12 and 48 hours/)
    expect(facts[0].setting).toBe('healthy adults')
  })
  it('table-row detector', () => {
    expect(looksLikeTableRow('High VOL BP (8x10x70%1RM), PR or AR (BP, 5x10x10%1RM) 6- & 30-h post; pec MT restored 24 h')).toBe(true)
    expect(looksLikeTableRow('Symptoms of exercise-induced muscle damage typically peak between 12 and 48 hours after exercise.')).toBe(false)
  })
  it('the extraction prompt carries the reader check and the applies field', () => {
    const p = extractionPrompt('Recovery', 'wellness', 'SOURCE PAGE: x', 'recovery')
    expect(p).toMatch(/READER CHECK/)
    expect(p).toMatch(/"applies": true\|false/)
  })
})

// Gemini read of the Argon bench (2026-11-13): four links sat on sentences
// their paper never made. Paragraphs and facts below are the real ones.
describe('fact anchor weighs rare terms and takes the best pair per URL', () => {
  const sittingHtml =
    '<p>Sitting for long periods at a desk or in a car is the most common trigger for the buttock weakness often called dead butt syndrome, and over time that can grow into buttock, hip and lower back pain. In my practice, runners, footballers and parents in the newborn months turn up with the same stiff, locked lower back as office workers. Fitness helps, but it doesn\'t cancel out three hours in one position.</p>\n' +
    '<p>Discs are a separate category. They flatten with age, and the water content of the disc drops from the plump, moist discs of childhood until they\'re comparatively thin and firm. A herniation is different again: the soft inner centre pushes through the outer wall and presses on a nerve, producing back, buttock or leg pain. Sitting can worsen those symptoms because pressure on the nerve root rises by approximately 40%. Most people with a herniation find relief without surgery. Anyone with degenerative discs is usually advised to take care with repeated bending, twisting and lifting, and that\'s worth raising with your practitioner.</p>\n' +
    '<p>Chiropractic care also has limits. If symptoms haven\'t improved after a few weeks of treatment, adjustments may not be the right approach for that person. Back and neck pain are the most common reasons people see a chiropractor, and the plan should be reviewed on that few-weeks timeline.</p>\n' +
    '<p>It\'s also why generic gym stretching can backfire. Pulling hard on hamstrings and the lower back when a joint isn\'t moving properly can aggravate the pain rather than ease it.</p>\n' +
    '<p>The routine above can ease stiffness within a session, but changing the underlying pattern takes weeks. Staying active is the most effective way to manage back pain, and active approaches like pilates, yoga and targeted strengthening give the most relief for non-specific back pain. Short, regular sessions suit most people better than one heroic effort.</p>\n' +
    '<p>The range runs from tired muscle through to the disc. A lumbar strain is an injury to the muscles, ligaments or tendons of the lower back, often from overuse, sudden movements or poor body mechanics. It tends to show up as local pain that\'s worse with movement, with tenderness, spasm and reduced range. Strains and sprains are the most common causes of back pain overall. Non-specific pain is usually a mix of weak or tense core muscles, physical strain, the way the brain processes pain, and stress.</p>'
  const HERNIA = 'https://pubmed.ncbi.nlm.nih.gov/37072094/'
  const MECH = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4926733/'
  const OVERVIEW = 'https://www.ncbi.nlm.nih.gov/books/NBK284941/'
  const DEADBUTT = 'https://health.clevelandclinic.org/no-joke-your-desk-job-promotes-dead-butt-syndrome'
  const sources = [
    { fact: 'Lower back pain and buttock or leg pain are commonly caused by lumbar disc herniations.', url: HERNIA, title: 'Lumbar Disc Herniation: Diagnosis and Management.', status: 'retrieved' as const },
    { fact: 'Most patients find relief for their symptoms through nonsurgical methods.', url: HERNIA, title: 'Lumbar Disc Herniation: Diagnosis and Management.', status: 'retrieved' as const },
    { fact: 'Muscle tension and spasm are among the most common reasons for low back pain.', url: MECH, title: 'Mechanisms of low back pain: a guide for diagnosis and therapy', status: 'retrieved' as const },
    { fact: 'Staying active and moving is the most effective way to manage and reduce pain in the back.', url: OVERVIEW, title: 'Overview: Low back pain', status: 'retrieved' as const },
    { fact: 'Sitting for long periods is the most common trigger of dead butt syndrome.', url: DEADBUTT, title: 'Dead Butt Syndrome: A Real Pain', status: 'retrieved' as const },
  ]

  it('keeps the herniation paper off the dead butt sentence and gives that sentence its own page', () => {
    const r = anchorFactSources(sittingHtml, sources)
    expect(r.html).not.toContain(`<a href="${HERNIA}"`)
    expect(r.html).toContain(`<a href="${DEADBUTT}" target="_blank" rel="noopener noreferrer">Sitting for long periods at a desk`)
    expect(r.unplaced.map((u) => u.url)).toContain(HERNIA)
  })

  it('leaves a sentence unlinked when only the topic words are shared (chiropractor timeline, hamstrings)', () => {
    const r = anchorFactSources(sittingHtml, sources)
    expect(r.html).not.toContain(`<a href="${MECH}"`)
    expect(r.html).not.toMatch(new RegExp(`<a href="${OVERVIEW}"[^>]*>Pulling hard on hamstrings`))
    expect(r.html).toContain(`<a href="${OVERVIEW}" target="_blank" rel="noopener noreferrer">Staying active is the most effective way to manage back pain`)
    expect(r.unplaced.map((u) => u.url)).toContain(MECH)
    expect(r.placed).toEqual(expect.arrayContaining([OVERVIEW, DEADBUTT]))
    expect(r.placed).toHaveLength(2)
  })

  it('gives a verbatim restatement to its own paper even when another paper shares the topic words (sports massage)', () => {
    const html =
      '<p>Sports massage is manual therapy for muscle and soft-tissue pain and weakness. It helps mostly through your nervous system and the way tissue responds to pressure, not by washing waste out of the muscle. Its main job is calming a body stuck in effort and giving sore tissue a different signal.</p>\n' +
      '<p>Deep tissue is a technique, and sports massage is the purpose it serves. Deep tissue work reaches the deeper layers of muscle and breaks down adhesions and scar tissue after hard training. Before an event, I keep the work short and light.</p>'
    const BEST = 'https://pubmed.ncbi.nlm.nih.gov/18806553/'
    const DEEP = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12140169/'
    const r = anchorFactSources(html, [
      { fact: 'Deep tissue massage targets the deeper layers of muscle and promotes the breakdown of adhesions and scar tissue in athletes.', url: DEEP, title: 'Deep Tissue Massage Therapy: Effects on Muscle Recovery and Performance in Athletes', status: 'retrieved' },
      { fact: 'Sports massage is a manual therapy used to address muscle and soft tissue pain and weakness.', url: BEST, title: 'Effectiveness of sports massage for recovery of skeletal muscle from strenuous exercise', status: 'retrieved' },
    ])
    expect(r.html).toContain(`<a href="${BEST}" target="_blank" rel="noopener noreferrer">Sports massage is manual therapy for muscle and soft-tissue pain and weakness</a>`)
    expect(r.html).toContain(`<a href="${DEEP}" target="_blank" rel="noopener noreferrer">Deep tissue work reaches the deeper layers`)
  })
})

describe('citation pool keeps every verified fact source past the cap', () => {
  it('caps the grounding pages, never the curated sources', () => {
    const curated = Array.from({ length: 16 }, (_, i) => ({ title: `fact ${i}`, url: `https://pubmed.ncbi.nlm.nih.gov/${1000 + i}/` }))
    const grounding = [{ title: 'nih.gov', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9/' }]
    const { pool } = rankCitationPool(curated, grounding, 14)
    expect(pool).toHaveLength(16)
    expect(pool.every((p) => p.origin === 'curated')).toBe(true)
    expect(rankCitationPool(curated.slice(0, 2), grounding, 3).pool).toHaveLength(3)
  })
})

describe('gloss path after the Gemini read (2026-11-13)', () => {
  it('rejects translation labels and hedges, keeps the practitioner register', () => {
    expect(glossGateReason('In plain terms, it means leaning in with a flat hand and waiting.')).toMatch(/label/)
    expect(glossGateReason('In practice, it means your cells can sense being pressed.')).toMatch(/label/)
    expect(glossGateReason('That is the sheet of connective tissue sitting just outside the muscle.')).toMatch(/label/)
    expect(glossGateReason('IGF-1 is a hormone the liver makes, and higher levels were what the researchers measured, which is not the same as proof of a particular outcome for any one person.')).toMatch(/hedge/)
    expect(glossGateReason('The iliacus is the fan-shaped muscle lining the inside of your pelvis, and it joins the psoas on its way to the thigh.')).toBeNull()
    expect(glossGateReason('The sacroiliac joints are the two joints at the back of your pelvis, one on each side, and I check them first.')).toBeNull()
  })
  it('never glosses the title term or a term inside a story sentence', () => {
    const explained = seedExplainedTerms('Sciatica Flare-Ups: What Actually Helps in the First 48 Hours', '<p>Sciatica is the name for pain that travels down the leg. Nothing switches it off in five minutes.</p><p>Radiculopathy, the medical name, is what I write on the file.</p>')
    expect(explained.has('sciatica')).toBe(true)
    expect(explained.has('radiculopathy')).toBe(true)
    expect(explained.has('what')).toBe(false)
    expect(glossSkipReason('Sciatica', 'Sciatica settles for most people within weeks.', explained)).toMatch(/already/)
    expect(glossSkipReason('HbA1c', 'A Dominican athlete in his forties came back with an HbA1c, I believe it was 7 or higher, and was told he would be diabetic.', explained)).toMatch(/story/)
    expect(glossSkipReason('Amalgam', "Her heavy-metal scan pointed to mercury from amalgam fillings she'd had in her mouth for more than 30 years.", explained)).toMatch(/story/)
    expect(glossSkipReason('nucleus pulposus', 'The soft centre of each disc, the nucleus pulposus, has a high water content.', explained)).toBeNull()
  })
  it('the gloss constructions ban the translation labels', () => {
    for (const c of [GLOSS_CONSEQUENCE, GLOSS_EXAMPLE, GLOSS_PLAIN, GLOSS_APPOSITION]) expect(c).toMatch(/In plain terms/)
  })
})

describe('default writer rules after the Gemini read (2026-11-13)', () => {
  it('keywords are topics, institutions are not named, contrasts and completion checks are capped', () => {
    expect(WRITER_USER_PROMPT).toContain('never phrases to print')
    expect(WRITER_USER_PROMPT).not.toContain('Weave keywords')
    expect(WRITER_SYSTEM_PROMPT).toContain('No finding is attributed to an institution by name')
    expect(WRITER_SYSTEM_PROMPT).not.toContain('you may attribute a finding to that institution by name')
    expect(WRITER_SYSTEM_PROMPT).toContain('no textbook register either')
    expect(WRITER_SYSTEM_PROMPT).toContain('appears at most once in the whole article; every other stage ends where its instruction ends')
    expect(WRITER_SYSTEM_PROMPT).toContain('is a move the article makes at most twice')
    expect(WRITER_SYSTEM_PROMPT).toContain('are named at most twice in the whole article')
    expect(WRITER_SYSTEM_PROMPT).toContain('never opens with a pronoun')
    expect(WRITER_SYSTEM_PROMPT).toContain('never follows directly on a sentence about your own experience')
    expect(WRITER_SYSTEM_PROMPT).toContain('in the first person, never as what another body advises')
    expect(RESEARCH_SYSTEM_PROMPT).toContain('without a biochemistry lesson')
    expect(extractionPrompt('Sustaining the signal', 'wellness', 'SOURCE PAGE: x', 'hyperbaric oxygen')).toMatch(/RELEVANCE CHECK/)
  })
})
