import { describe, it, expect } from 'vitest'
import { assembleBackfill, assembleProfile, backfillPrompt, cleanSpoken, fixPracticeName, isVerbatim, prepareMaterial, profilePrompt, profileToMarkdown, slicePassage, type AuthorMaterial } from '../profile'

const material: AuthorMaterial = {
  author: { name: 'Ana Ruiz', practice: 'Tide Clinic', industry: 'Wellness', location: 'Lisbon, Portugal' },
  brand: { ourExperience: 'Founded in 2015.' },
  answers: {
    q_line: "I refuse to compromise on honesty. If I know that something works, I will suggest it. If it doesn't, I'll say so, even when it costs me the sale.",
    q_enemy: 'What drives me crazy is people who follow an influencer with no training. They buy the powder, and then they come to me worse than before.',
    q_moments:
      'One client, a runner in his forties, came in sure he needed surgery. I sat with him for an hour and we looked at how he slept. Three weeks later he ran again, and he cried in my office. That was a good day.',
    q_proof: 'On the first visit I sit down with them myself and listen. Then our massage therapist, Joao, does the hands-on work.',
  },
  sample: { title: 'On rest', text: "Rest is not a reward. Rest is the work! You don't earn it, you need it. And if you think you can skip it, well, your body keeps the score." },
}

describe('cleanSpoken', () => {
  it('takes out filler and stammers and leaves the words alone', () => {
    expect(cleanSpoken('Um, I I think that, uh, rest is is the work .')).toBe('I think that, rest is the work.')
  })
  it('keeps a double that is real English', () => {
    expect(cleanSpoken('She had had two hip replacements, and I knew that that mattered.')).toBe('She had had two hip replacements, and I knew that that mattered.')
  })
})

describe('fixPracticeName', () => {
  it('puts right a practice name the transcript misheard', () => {
    expect(fixPracticeName('the modalities we have at Wealth Recovery Center will', 'Whealth Recovery Center')).toBe('the modalities we have at Whealth Recovery Center will')
  })
  it('leaves the word alone anywhere else', () => {
    expect(fixPracticeName('health is wealth, and our recovery center is small', 'Whealth Recovery Center')).toBe('health is wealth, and our recovery center is small')
    expect(fixPracticeName('the Stealth Bomber Recovery Center', 'Whealth Recovery Center')).toBe('the Stealth Bomber Recovery Center')
  })
})

describe('prepareMaterial', () => {
  it('cleans spoken answers, leaves written ones as written, and takes bullet marks out of the piece', () => {
    const spoken = prepareMaterial({ ...material, answers: { q_line: 'Um, I I refuse.' }, sample: { text: '• First point.\n■ Second point (SHOW) here. • Third. [PAUSE. Move to the easel.]\nShe (my aunt) laughed.' } })
    expect(spoken.answers.q_line).toBe('I refuse.')
    expect(spoken.sample?.text.trim()).toBe('First point.\nSecond point here. Third. \nShe (my aunt) laughed.')
    const written = prepareMaterial({ ...material, derivedAnswers: true, answers: { q_line: 'Very very true, um, as they say.' } })
    expect(written.answers.q_line).toBe('Very very true, um, as they say.')
  })
})

describe('isVerbatim', () => {
  const text = material.answers.q_line!
  it('accepts a passage that is there, whatever the punctuation or case', () => {
    expect(isVerbatim('if I know that something works I will suggest it', text)).toBe(true)
    expect(isVerbatim('If it doesn’t, I’ll say so', text)).toBe(true)
  })
  it('accepts a passage shortened with an ellipsis when every part is there', () => {
    expect(isVerbatim("I refuse to compromise on honesty ... even when it costs me the sale", text)).toBe(true)
  })
  it('refuses a paraphrase', () => {
    expect(isVerbatim('I never compromise on being honest with people', text)).toBe(false)
    expect(isVerbatim('honesty', text)).toBe(false)
  })
})

describe('slicePassage', () => {
  const text = material.answers.q_moments!
  it('cuts the passage out in the original wording, punctuation kept', () => {
    expect(slicePassage(text, 'one client a runner in his forties', 'he cried in my office')).toBe(
      'One client, a runner in his forties, came in sure he needed surgery. I sat with him for an hour and we looked at how he slept. Three weeks later he ran again, and he cried in my office.',
    )
  })
  it('finds a passage across hyphens, quote marks and words that only look alike', () => {
    const t = 'We restart often. “Ouch”, I said. I had a high-flying job. The salary was good. It was the very thing that hurt me. Then I left.'
    expect(slicePassage(t, 'I had a high-flying job.', 'the very thing that hurt me')).toBe('I had a high-flying job. The salary was good. It was the very thing that hurt me.')
    expect(slicePassage(t, 'Ouch, I said. I had', 'The salary was good')).toBe('“Ouch”, I said. I had a high-flying job. The salary was good.')
    expect(slicePassage('We restart often and start to run now.', 'start to run', 'to run now')).toBe('start to run now.')
  })
  it('returns nothing when the start or the end is not in the text', () => {
    expect(slicePassage(text, 'one patient who was a swimmer', 'he cried in my office')).toBeNull()
    expect(slicePassage(text, 'one client a runner in his forties', 'and he never came back')).toBeNull()
  })
})

describe('assembleProfile', () => {
  const raw = JSON.stringify({
    role: 'Founder who listens first',
    does: ['On the first visit I sit down with them myself and listen.', 'I personally adjust every spine.'],
    team_does: ['Then our massage therapist, Joao, does the hands-on work.'],
    beliefs: [
      { kind: 'line', quote: 'I refuse to compromise on honesty.', topics: ['Honesty', 'sales'] },
      { kind: 'stands_for', quote: 'Rest is not a reward. Rest is the work!', topics: ['rest'] },
      { kind: 'fights', quote: 'Influencers are ruining the wellness industry.', topics: ['influencers'] },
      { kind: 'nonsense', quote: 'Rest is the work!', topics: [] },
    ],
    stories: [
      { kind: 'client', starts: 'One client, a runner in his forties, came', ends: 'he cried in my office', topics: ['running', 'sleep'] },
      { kind: 'client', starts: 'A woman who could not sleep came', ends: 'and she slept at last', topics: ['sleep'] },
    ],
    habits: [
      { habit: 'States a rule, then repeats it harder', example: 'Rest is not a reward. Rest is the work!', where: 'opening', seen: 2 },
      { habit: 'Uses long clinical sentences', example: 'The parasympathetic nervous system governs restoration.', where: 'anywhere', seen: 4 },
    ],
    phrases: ['keeps the score', 'Rest is the work', 'holistic journey'],
    opening: { habit: 'Opens on a flat statement', example: 'Rest is not a reward.' },
    closing: { habit: 'Closes on a warning', example: 'Sleep or suffer.' },
    reader: 'Speaks straight to "you".',
  })
  const p = assembleProfile(material, `Here you go:\n${raw}`)

  it('keeps what the author said and drops what the model made up', () => {
    expect(p.identity.does).toEqual(['On the first visit I sit down with them myself and listen.'])
    expect(p.identity.teamDoes).toHaveLength(1)
    expect(p.beliefs.map((b) => b.statement)).toEqual(['I refuse to compromise on honesty.', 'Rest is not a reward. Rest is the work!'])
    expect(p.beliefs[0].topics).toEqual(['honesty', 'sales'])
    expect(p.stories).toHaveLength(1)
    expect(p.stories[0].text).toMatch(/^One client, a runner.*cried in my office\.$/)
    expect(p.manner.habits).toHaveLength(1)
    expect(p.manner.phrases).toEqual(['keeps the score', 'Rest is the work'])
    expect(p.manner.opening?.example).toBe('Rest is not a reward.')
    expect(p.manner.closing).toBeNull()
  })
  it('counts what it dropped, so a poor extraction is visible', () => {
    // one "does", one belief, one story, one habit, one closing
    expect(p.basis.quotesDropped).toBe(5)
    expect(p.basis.dropped).toContain('I personally adjust every spine.')
    expect(p.basis.dropped.some((d) => d.startsWith('story: A woman who could not sleep'))).toBe(true)
  })
  it('carries the words themselves and the measurements made on them', () => {
    expect(p.manner.ownWords.map((w) => w.source)).toEqual(['q_enemy', 'q_line', 'q_moments', 'q_proof', 'sample'])
    // 100 words of answers is too little to measure; the short piece likewise.
    expect(p.manner.measured.sample).toBeNull()
    const long = assembleProfile({ ...material, answers: { q_line: Array(8).fill(material.answers.q_line).join(' ') } }, '{}')
    expect(long.manner.measured.answers?.fpSingular).toBeGreaterThan(3)
    expect(p.basis.sampleWords).toBeGreaterThan(20)
    expect(p.basis.derivedAnswers).toBe(false)
  })
  it('carries the statement in the account of what the author does personally', () => {
    expect(p.identity.stated).toBeNull()
    expect(profileToMarkdown(p)).toContain('do not say what the author does personally')
    const withLine = assembleProfile({ ...material, ownWork: ' I see every new client myself. Joao does the massage. ' }, raw)
    expect(withLine.identity.stated).toBe('I see every new client myself. Joao does the massage.')
    expect(profileToMarkdown(withLine)).toContain('From the account settings: I see every new client myself.')
    expect(profilePrompt({ ...material, ownWork: 'Joao does the massage.' })).toContain('Joao does the massage.')
    // The builder quoting the settings line back is neither kept as the author's words nor counted as invented.
    const echoed = assembleProfile({ ...material, ownWork: 'I see every new client myself. Joao does the massage.' }, JSON.stringify({ does: ['I see every new client myself.'], team_does: ['Joao does the massage.'] }))
    expect(echoed.identity.does).toEqual([])
    expect(echoed.identity.teamDoes).toEqual([])
    expect(echoed.basis.quotesDropped).toBe(0)
  })
  it('survives a reply that is not JSON', () => {
    const empty = assembleProfile(material, 'I could not do this.')
    expect(empty.beliefs).toEqual([])
    expect(empty.manner.ownWords).toHaveLength(5)
  })
  it('renders a page a person can read', () => {
    const md = profileToMarkdown(p)
    expect(md).toContain('# Voice profile: Ana Ruiz')
    expect(md).toContain('Lines they will not cross')
    expect(md).toContain('"I refuse to compromise on honesty."')
    expect(md).toContain('What they say the team does')
    // A made-up belief shows only in the list of what was left out, never among the beliefs.
    expect(md.split('## What they believe')[1]).not.toContain('Influencers are ruining')
    expect(md.split('## What they believe')[0]).toContain('Influencers are ruining')
  })
})

describe('prompts', () => {
  it('shows the model every answer under its question, and the written piece', () => {
    const prompt = profilePrompt(material)
    expect(prompt).toContain('[q_line] Asked: What do you refuse to compromise on')
    expect(prompt).toContain('A PIECE THEY WROTE ("On rest")')
    expect(prompt).not.toContain('[q_tribe]')
  })
})

describe('backfill for a simulated onboarding', () => {
  const essays = [{ title: 'On rest', text: material.sample!.text }, { title: 'A day', text: material.answers.q_moments! }]
  it('asks all seven questions of the essays', () => {
    const prompt = backfillPrompt('Ana Ruiz', essays)
    expect(prompt).toContain('[q_proof]')
    expect(prompt).toContain('=== A day ===')
  })
  it('builds answers only from passages that are really in the essays', () => {
    const { answers, dropped } = assembleBackfill(
      JSON.stringify({
        q_line: [{ starts: 'Rest is not a reward. Rest is', ends: "you don't earn it, you need it" }],
        q_moments: [{ starts: 'One client, a runner in his forties', ends: 'That was a good day' }, { starts: 'Another time a child came in', ends: 'and that was that' }],
        q_tribe: [],
      }),
      essays,
    )
    expect(answers.q_line).toBe("Rest is not a reward. Rest is the work! You don't earn it, you need it.")
    expect(answers.q_moments).toMatch(/That was a good day\.$/)
    expect(answers.q_tribe).toBeUndefined()
    expect(dropped).toBe(1)
  })
})
