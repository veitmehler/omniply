/**
 * Author-voice plan, stage 2: the acceptance test on a voice bench.
 *
 * Reads the bench articles (the same topics written for both authors, on the
 * standard path and on the voice path) and asks the attribution judge who wrote
 * each one. Two judgings per article, three votes each:
 *   A (manner)      the author's samples hold no client case; for Mark they are
 *                   the essays held back from his profile.
 *   B (onboarding)  the samples are the material onboarding collected, as it is:
 *                   "does this sound like the person who gave these answers?"
 * An article passes a judging when the judge names its author and does not say
 * "none of these writers fits". The code voice score is printed next to it as a
 * secondary number.
 *
 * It writes no article and changes no data.
 *
 *   npx tsx --env-file=../../.env scripts/voice-bench-judge.ts <material-dir> <profiles-dir> <articles.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'fs'
import { buildReference, chunkProse, toProse, voiceScore, wordCount } from '../src/lib/voice/voice-score'
import { attribute, maskIdentity, type LineupCandidate } from '../src/lib/voice/attribution'
import { ownWordsForWriter } from '../src/lib/voice/render'
import type { VoiceProfile } from '../src/lib/voice/profile'
import { GeminiAdapter } from '../src/article-pipeline/llm/gemini'
import { flushCallStats } from '../src/lib/net/call-stats'

const [DIR, PROFILES, ARTICLES, OUT] = process.argv.slice(2)
const JUDGE_MODEL = 'gemini-3.1-pro-preview'
const VOTES = 3
const MASK = ['Dr Mark Postles DC', 'Mark Postles', 'Postles', 'Mark', 'Coast Chiropractic Kawana', 'Coast Chiropractic', 'CCK', 'Kawana', 'Buddina', 'Sunshine Coast', 'Queensland', 'Australia', 'Australian', 'Karen Phillips', 'Karen', 'Sally Battle', 'Sally', 'Bridget', 'Melling-Williams', 'Dasha Maximov', 'Dasha', 'Maximov', 'Whealth Recovery Center', 'Whealth Recovery Clinic', 'Wealth Recovery Center', 'Whealth', 'Cabarete', 'Dominican Republic', 'Dominican', 'Kite Beach', 'Plaza Mariposa', 'Vanessa Ayan', 'Vanessa', 'Dennis Ripoll Cid', 'Dennis', 'Emma Toms', 'Emma', 'Healing The Source', 'Substack']

interface Post { title: string; date: string; words: number; text: string }
const posts = (file: string): Post[] => JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8')) as Post[]
const texts = (file: string, min: number) => posts(file).filter((p) => p.words >= min).map((p) => p.text)
const profile = (slug: string) => JSON.parse(readFileSync(`${PROFILES}/${slug}.json`, 'utf8')) as { profile: VoiceProfile; usedEssays?: Array<{ title: string; date: string }> }

const mark = profile('mark-postles')
const dasha = profile('dasha-maximov')
const used = new Set((mark.usedEssays ?? []).map((e) => `${e.title}|${e.date}`))
const markHeld = posts('mark-postles.json').filter((p) => p.words >= 250 && !used.has(`${p.title}|${p.date}`)).map((p) => p.text)

// The two sample sets per bench author. Everyone else in the line-up is the same in both judgings.
const samplesA: Record<string, string[]> = {
  mark: markHeld,
  dasha: ownWordsForWriter(dasha.profile).map((w) => w.text),
}
const samplesB: Record<string, string[]> = {
  mark: mark.profile.manner.ownWords.map((w) => w.text),
  dasha: dasha.profile.manner.ownWords.map((w) => w.text),
}
const others: Record<string, string[]> = {
  karen: texts('karen-phillips.json', 200),
  sally: texts('sally-battle.json', 200),
  bridget: texts('bridget-melling-williams.json', 200),
  emma: texts('substack-emmatoms.json', 250),
  hts: texts('substack-healingthesource.json', 250),
}
const lineup = (own: Record<string, string[]>): LineupCandidate[] =>
  Object.entries({ ...own, ...others }).map(([id, ts]) => ({ id, samples: chunkProse(ts.join('\n\n'), 600).map((p) => maskIdentity(p, MASK)) }))

interface BenchArticle { id: string; author: 'mark' | 'dasha'; mode: 'on' | 'off'; topic: string; status: string; final: string; draft: string }
const articles = JSON.parse(readFileSync(ARTICLES, 'utf8')) as BenchArticle[]
/** The article as a reader sees it, without the byline line. */
const body = (html: string) => toProse(html).split('\n').filter((l) => !/^Written by\b/i.test(l.trim())).join('\n')

async function main() {
  const gemini = new GeminiAdapter()
  let cost = 0
  const call = async (prompt: string) => {
    const r = await gemini.call({ userPrompt: prompt, model: JUDGE_MODEL, temperature: 0, maxTokens: 3000, jsonMode: true, thinkingLevel: 'low' })
    cost += r.cost ?? 0
    return r.content
  }
  const A = lineup(samplesA)
  const B = lineup(samplesB)
  // Secondary number: the code score against the manner samples.
  const ref = buildReference(Object.fromEntries(A.map((c) => [c.id, c.samples])))
  const rows: any[] = []
  console.log(`line-up: ${A.map((c) => `${c.id} ${c.samples.length}`).join(', ')} | Mark held-back essays ${markHeld.length}`)
  for (const a of articles) {
    if (!a.final) {
      console.log(`${a.author.padEnd(5)} ${a.mode.padEnd(3)} ${a.topic.slice(0, 30).padEnd(30)} (no finished article: ${a.status})`)
      continue
    }
    const text = maskIdentity(body(a.final), MASK)
    const ja = await attribute({ text, candidates: A, call, votes: VOTES, seed: 11 })
    const jb = await attribute({ text, candidates: B, call, votes: VOTES, seed: 23 })
    const code = voiceScore(text, a.author, ref)
    const pass = (j: typeof ja) => j.winner === a.author && j.noneFits === 0
    const row = {
      id: a.id, author: a.author, mode: a.mode, topic: a.topic, words: wordCount(text),
      A: { winner: ja.winner, own: ja.firstPlaces[a.author], votes: ja.votes, noneFits: ja.noneFits, place: ja.meanPlace[a.author], pass: pass(ja), evidence: ja.evidence },
      B: { winner: jb.winner, own: jb.firstPlaces[a.author], votes: jb.votes, noneFits: jb.noneFits, place: jb.meanPlace[a.author], pass: pass(jb), evidence: jb.evidence },
      code: { score: Number(code.score.toFixed(3)), rank: code.rank, nearest: code.nearest },
    }
    rows.push(row)
    const f = (j: typeof row.A) => `${j.winner.padEnd(7)} own ${j.own}/${j.votes} none ${j.noneFits}/${j.votes} ${j.pass ? 'PASS' : 'fail'}`
    console.log(`${a.author.padEnd(5)} ${a.mode.padEnd(3)} ${a.topic.slice(0, 30).padEnd(30)} | A ${f(row.A)} | B ${f(row.B)} | code ${row.code.score >= 0 ? '+' : ''}${row.code.score.toFixed(2)} #${row.code.rank} (${row.code.nearest})`)
  }
  for (const mode of ['off', 'on'] as const) {
    const rs = rows.filter((r) => r.mode === mode)
    for (const author of ['mark', 'dasha'] as const) {
      const ra = rs.filter((r) => r.author === author)
      if (!ra.length) continue
      const sum = (k: 'A' | 'B', f: (j: any) => number) => ra.reduce((n, r) => n + f(r[k]), 0)
      console.log(`SUMMARY ${mode.padEnd(3)} ${author.padEnd(5)}: A named ${ra.filter((r) => r.A.winner === author).length}/${ra.length}, pass ${ra.filter((r) => r.A.pass).length}/${ra.length}, none-fits ${sum('A', (j) => j.noneFits)}/${sum('A', (j) => j.votes)} | B named ${ra.filter((r) => r.B.winner === author).length}/${ra.length}, pass ${ra.filter((r) => r.B.pass).length}/${ra.length}, none-fits ${sum('B', (j) => j.noneFits)}/${sum('B', (j) => j.votes)} | code mean ${(ra.reduce((n, r) => n + r.code.score, 0) / ra.length).toFixed(2)}`)
    }
  }
  console.log(`judge cost $${cost.toFixed(3)}`)
  writeFileSync(OUT, JSON.stringify({ rows, cost }, null, 1))
  await flushCallStats().catch(() => undefined)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
