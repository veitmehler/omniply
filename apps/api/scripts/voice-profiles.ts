/**
 * Author-voice plan, stage 1: build the voice profiles of the two bench
 * authors from onboarding material, for a person to read and judge.
 *
 *  - Dasha: her stored onboarding answers and her one written piece.
 *  - Mark: a simulated onboarding. One essay stands in for the written piece;
 *    his seven answers are found in a handful of his other essays, word for
 *    word. Every essay not used here stays held out for the judge.
 *
 * It generates no article and changes no data. Material is read from a folder
 * outside the repository; the profiles hold the authors' own words, so the
 * output folder is not committed either.
 *
 *   npx tsx --env-file=../../.env scripts/voice-profiles.ts <material-dir> <out-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { assembleBackfill, assembleProfile, backfillPrompt, prepareMaterial, profilePrompt, profileToMarkdown, type AuthorMaterial, type QuestionId } from '../src/lib/voice/profile'
import { wordCount } from '../src/lib/voice/voice-score'
import { GeminiAdapter } from '../src/article-pipeline/llm/gemini'
import { flushCallStats } from '../src/lib/net/call-stats'

const [DIR, OUT] = process.argv.slice(2)
const MODEL = process.env.VOICE_PROFILE_MODEL || 'gemini-3.1-pro-preview'

/** Mark's stand-in for "the one piece you gave us". */
const MARK_SAMPLE = 'Innate Intelligence'
/** The essays his seven answers are looked for in. Title plus year, since he reused a title. */
const MARK_BACKFILL: Array<[string, string]> = [
  ['Philosophy – Do You Really Need It?', '2019'],
  ['Principles To Live By', '2018'],
  ['Awaken Your Superpower', '2020'],
  ['The Drive To THRIVE', '2020'],
  ['Unlocking the Power of Strategy for Your Health', '2023'],
  ['Time: Your Greatest Asset', '2025'],
  ['Purpose Changes Everything', '2026'],
  ['Understanding You', '2010'],
]

const gemini = new GeminiAdapter()
let cost = 0
async function call(prompt: string): Promise<string> {
  const r = await gemini.call({ userPrompt: prompt, model: MODEL, temperature: 0, maxTokens: 12000, jsonMode: true, thinkingLevel: 'low' })
  cost += r.cost ?? 0
  return r.content
}

async function build(slug: string, given: AuthorMaterial, extra: Record<string, unknown> = {}) {
  if (process.env.VOICE_ONLY && !slug.startsWith(process.env.VOICE_ONLY)) return
  const m = prepareMaterial(given)
  const profile = assembleProfile(m, await call(profilePrompt(m)))
  writeFileSync(`${OUT}/${slug}.json`, JSON.stringify({ profile, ...extra }, null, 1))
  writeFileSync(`${OUT}/${slug}.md`, profileToMarkdown(profile))
  console.log(
    `${slug}: answers ${profile.basis.spokenWords}w, piece ${profile.basis.sampleWords}w | does ${profile.identity.does.length}, team ${profile.identity.teamDoes.length}, beliefs ${profile.beliefs.length}, stories ${profile.stories.length}, habits ${profile.manner.habits.length}, phrases ${profile.manner.phrases.length} | dropped ${profile.basis.quotesDropped}`,
  )
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const d = JSON.parse(readFileSync(`${DIR}/dasha-raw.json`, 'utf8')) as { spoken: Partial<Record<QuestionId, string>>; writingSample: string; brand: AuthorMaterial['brand']; ownWork?: string }
  await build('dasha-maximov', {
    author: { name: 'Dasha Maximov', practice: 'Whealth Recovery Center', industry: 'Wellness & Recovery', location: 'Cabarete, Dominican Republic' },
    brand: { businessDescription: d.brand.businessDescription, who: d.brand.who, ourExperience: d.brand.ourExperience },
    answers: d.spoken,
    // The settings line "What the author does personally", as stored on the account.
    ownWork: d.ownWork ?? null,
    sample: { text: d.writingSample, title: 'The Drug of Love (talk outline)' },
  })

  const posts = JSON.parse(readFileSync(`${DIR}/mark-postles.json`, 'utf8')) as Array<{ date: string; title: string; text: string; words: number }>
  const brand = (JSON.parse(readFileSync(`${DIR}/brand.json`, 'utf8')) as { mark: AuthorMaterial['brand'] }).mark
  const sample = posts.find((p) => p.title === MARK_SAMPLE)
  if (!sample) throw new Error(`sample essay not found: ${MARK_SAMPLE}`)
  const essays = MARK_BACKFILL.map(([title, year]) => {
    const p = posts.find((x) => x.title === title && x.date.startsWith(year))
    if (!p) throw new Error(`backfill essay not found: ${title} (${year})`)
    return p
  })
  if (process.env.VOICE_ONLY && !'mark-postles'.startsWith(process.env.VOICE_ONLY)) return finish()
  const { answers, dropped } = assembleBackfill(await call(backfillPrompt('Mark Postles', essays)), essays)
  console.log(`mark backfill: ${Object.entries(answers).map(([q, a]) => `${q} ${wordCount(a ?? '')}w`).join(', ')} | passages not found: ${dropped}`)
  await build(
    'mark-postles',
    {
      author: { name: 'Mark Postles', practice: 'Coast Chiropractic Kawana', industry: 'Chiropractor', location: 'Queensland, Australia' },
      brand: { businessDescription: brand.businessDescription, who: brand.who, ourExperience: brand.ourExperience },
      answers,
      sample: { text: sample.text, title: sample.title },
      derivedAnswers: true,
    },
    // Everything used here is no longer unseen writing; the judge must not be shown it as a held-out piece.
    { usedEssays: [sample, ...essays].map((p) => ({ title: p.title, date: p.date, words: p.words })), backfillPassagesNotFound: dropped },
  )
  await finish()
}

async function finish() {
  console.log(`cost $${cost.toFixed(3)} (${MODEL})`)
  await flushCallStats().catch(() => undefined)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
