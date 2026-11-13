import { beforeAll, describe, expect, it } from 'vitest'
import { resolve } from 'path'

// Dynamic imports by variable path: tsc (rootDir = apps/api/src) does not
// follow them, vitest resolves them at run time.
const DB_PRISMA = resolve(__dirname, '../../../../../packages/db/prisma')
let AZAVEA_EDITOR_SYSTEM_PROMPT = ''
let AZAVEA_RESEARCH_SYSTEM_PROMPT = ''
let AZAVEA_TITLE_RULE = ''
let AZAVEA_WRITER_SYSTEM_PROMPT = ''
let AZAVEA_WRITER_USER_PROMPT = ''
let AZAVEA_EDITOR_USER_PROMPT = ''
let WRITER_SYSTEM_PROMPT = ''
let WRITER_USER_PROMPT = ''
beforeAll(async () => {
  const azavea = (await import(/* @vite-ignore */ `${DB_PRISMA}/azavea-writer-prompts.ts`)) as Record<string, string>
  const defaults = (await import(/* @vite-ignore */ `${DB_PRISMA}/article-writer-prompts.ts`)) as Record<string, string>
  ;({ AZAVEA_EDITOR_SYSTEM_PROMPT, AZAVEA_EDITOR_USER_PROMPT, AZAVEA_RESEARCH_SYSTEM_PROMPT, AZAVEA_TITLE_RULE, AZAVEA_WRITER_SYSTEM_PROMPT, AZAVEA_WRITER_USER_PROMPT } = azavea)
  ;({ WRITER_SYSTEM_PROMPT, WRITER_USER_PROMPT } = defaults)
})

/** The module throws at import when a default-prompt anchor drifts; this test
 *  pins the Gemini-round rules (2026-11-12) and proves the defaults untouched. */
describe('Azavea writer overrides (derived, defaults untouched)', () => {
  it('carries the 2026-11-12 content rules', () => {
    for (const k of [
      'A fact belongs to the section or question it is listed under',
      'Every figure from the brief says in plain words where it comes from',
      'never in sentences that announce it',
      'told plainly in the third person',
      'patient visit average',
      'net revenue retention',
      'Google Business Profile',
      'same frame, one thing set against another, is a move the article makes at most twice',
      'at least one paragraph in the article is a single sentence',
      'a search phrase printed as typed',
    ]) expect(AZAVEA_WRITER_SYSTEM_PROMPT, k).toContain(k)
    expect(AZAVEA_WRITER_USER_PROMPT).toContain('never phrases to print')
    expect(AZAVEA_WRITER_USER_PROMPT).not.toContain('Weave keywords where they read naturally')
    expect(AZAVEA_EDITOR_SYSTEM_PROMPT).toContain('from the third occurrence on')
    expect(AZAVEA_RESEARCH_SYSTEM_PROMPT).toContain('software-subscription metrics')
    expect(AZAVEA_TITLE_RULE).toMatch(/names the reader/)
    expect(AZAVEA_TITLE_RULE).toMatch(/never as a search phrase printed as typed/)
    expect(AZAVEA_WRITER_USER_PROMPT).toContain('paraphrased whenever the phrase reads like a search query')
    expect(AZAVEA_WRITER_SYSTEM_PROMPT).toContain('plain markdown table of at most five rows')
    expect(AZAVEA_EDITOR_USER_PROMPT).toContain('<table>')
  })
  it('leaves the clinic defaults without any of them', () => {
    for (const k of ['net revenue retention', 'same-frame', 'Google Business Profile', 'told plainly in the third person']) {
      expect(WRITER_SYSTEM_PROMPT).not.toContain(k)
    }
    expect(WRITER_USER_PROMPT).toContain('never phrases to print') // 2026-11-13: keywords-as-topics is the default too
    expect(WRITER_SYSTEM_PROMPT).not.toContain('markdown table')
  })
})
