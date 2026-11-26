/**
 * Author-voice plan, stage 0: the baseline. Reads material from a folder
 * outside the repository (authors' real writing and the bench articles),
 * prints how well the voice score and the attribution judge recognise real
 * writing, and scores the bench articles at each stage of the pipeline.
 * It generates no article and changes no data.
 *
 *   npx tsx --env-file=../../.env scripts/voice-baseline.ts <material-dir> <out.json> [score|judge|all]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { buildReference, chunkProse, toProse, voiceScore, voiceGaps, wordCount } from '../src/lib/voice/voice-score'
import { attribute, maskIdentity, type LineupCandidate } from '../src/lib/voice/attribution'
import { GeminiAdapter } from '../src/article-pipeline/llm/gemini'
import { flushCallStats } from '../src/lib/net/call-stats'

const [DIR, OUT, MODE = 'score'] = process.argv.slice(2)
const JUDGE_MODEL = 'gemini-3.1-pro-preview'
const MASK = ['Mark Postles', 'Postles', 'Mark', 'Coast Chiropractic Kawana', 'Coast Chiropractic', 'CCK', 'Kawana', 'Buddina', 'Sunshine Coast', 'Queensland', 'Australia', 'Australian', 'Karen Phillips', 'Karen', 'Sally Battle', 'Sally', 'Bridget', 'Melling-Williams', 'Dasha Maximov', 'Dasha', 'Maximov', 'Whealth Recovery Center', 'Whealth Recovery Clinic', 'Whealth', 'Cabarete', 'Dominican Republic', 'Dominican', 'Kite Beach', 'Plaza Mariposa', 'Emma Toms', 'Emma', 'Healing The Source', 'Substack']

const posts = (file: string, min: number): string[] => (JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8')) as Array<{ words: number; text: string }>).filter((p) => p.words >= min).map((p) => p.text)
function dasha(): { spoken: string[]; outline: string[] } {
  const d = JSON.parse(readFileSync(`${DIR}/dasha-raw.json`, 'utf8')) as { spoken: Record<string, string>; writingSample: string; stories: Array<{ originalText: string | null }> }
  const spoken = [...Object.values(d.spoken), ...d.stories.map((s) => s.originalText ?? '')].filter((t) => t.trim().length > 80)
  return { spoken, outline: [d.writingSample] }
}

const material: Record<string, string[]> = {
  mark: posts('mark-postles.json', 250),
  karen: posts('karen-phillips.json', 200),
  sally: posts('sally-battle.json', 200),
  bridget: posts('bridget-melling-williams.json', 200),
  // VOICE_DASHA=spoken leaves her talk outline out: an outline is fragments and stage headings, not her prose.
  dasha: process.env.VOICE_DASHA === 'spoken' ? dasha().spoken : [...dasha().spoken, ...dasha().outline],
  emma: posts('substack-emmatoms.json', 250),
  hts: posts('substack-healingthesource.json', 250),
}
const pieces: Record<string, string[]> = {}
const PIECE = Number(process.env.VOICE_PIECE || 600)
for (const [a, texts] of Object.entries(material)) pieces[a] = chunkProse(texts.join('\n\n'), PIECE)

interface BenchArticle { set: 'chiro' | 'wellness'; id: string; createdAt: string; title: string; step9: string; step11: string; final: string }
const articles = JSON.parse(readFileSync(`${DIR}/bench-articles.json`, 'utf8')) as BenchArticle[]
const benchOf = (a: BenchArticle) => (a.createdAt.startsWith('2026-11-13') ? 'ARGON' : a.createdAt.startsWith('2026-11-24') ? 'GEMINI2' : 'FITNESS')
const authorOf = (a: BenchArticle) => (a.set === 'chiro' ? 'mark' : 'dasha')
/** The article as a reader sees it, without the byline line. */
const body = (html: string) => toProse(html).split('\n').filter((l) => !/^Written by\b/i.test(l.trim())).join('\n')

const result: any = { material: Object.fromEntries(Object.entries(pieces).map(([a, p]) => [a, { words: wordCount(material[a].join('\n')), pieces: p.length }])) }

function scorePart() {
  console.log('\nMaterial:', Object.entries(result.material).map(([a, m]: any) => `${a} ${m.words}w/${m.pieces}`).join(' | '))
  // 1. Can the score recognise real writing? Hold each piece out, rebuild the reference without it, see whom it lands on.
  const loo: Record<string, { n: number; right: number; meanScore: number }> = {}
  for (const [author, ps] of Object.entries(pieces)) {
    let right = 0, sum = 0
    for (let i = 0; i < ps.length; i++) {
      const ref = buildReference({ ...pieces, [author]: ps.filter((_, k) => k !== i) })
      const r = voiceScore(ps[i], author, ref)
      if (r.rank === 1) right++
      sum += r.score
    }
    loo[author] = { n: ps.length, right, meanScore: sum / Math.max(1, ps.length) }
  }
  result.scoreOnRealWriting = loo
  console.log(`\nVoice score on held-out pieces of REAL writing (each about ${PIECE} words):`)
  for (const [a, l] of Object.entries(loo)) console.log(`  ${a.padEnd(8)} ${l.right}/${l.n} assigned to the right writer | mean score ${l.meanScore.toFixed(2)}`)
  const tot = Object.values(loo).reduce((x, l) => ({ n: x.n + l.n, right: x.right + l.right }), { n: 0, right: 0 })
  console.log(`  ALL      ${tot.right}/${tot.n} (${Math.round((100 * tot.right) / tot.n)}%) | chance would be ${Math.round(100 / Object.keys(pieces).length)}%`)

  // 2. The bench articles, at each stage.
  const ref = buildReference(pieces)
  result.articles = []
  console.log('\nBench articles, voice score against their own author (positive = closer to them than to the other writers):')
  for (const a of articles) {
    const author = authorOf(a)
    const stages: any = {}
    for (const [stage, text] of [['draft', a.step9], ['corrected', a.step11], ['final', a.final]] as const) {
      if (!text) continue
      const r = voiceScore(body(text), author, ref)
      stages[stage] = { score: Number(r.score.toFixed(3)), rank: r.rank, nearest: r.nearest, words: wordCount(body(text)) }
    }
    const row = { bench: benchOf(a), set: a.set, id: a.id, title: a.title, author, stages, gaps: voiceGaps(body(a.final), author, ref, 8) }
    result.articles.push(row)
    console.log(`  ${row.bench.padEnd(8)} ${author.padEnd(6)} ${String(a.title).slice(0, 34).padEnd(34)} draft ${fmt(stages.draft)} | corrected ${fmt(stages.corrected)} | final ${fmt(stages.final)}`)
  }
  const avg = (bench: string, set: string, stage: string) => {
    const xs = result.articles.filter((r: any) => r.bench === bench && r.set === set && r.stages[stage]).map((r: any) => r.stages[stage].score)
    return xs.length ? (xs.reduce((x: number, y: number) => x + y, 0) / xs.length).toFixed(2) : '-'
  }
  console.log('\nAverages:')
  for (const bench of ['ARGON', 'GEMINI2', 'FITNESS']) for (const set of ['chiro', 'wellness']) console.log(`  ${bench.padEnd(8)} ${set.padEnd(9)} draft ${avg(bench, set, 'draft')} | corrected ${avg(bench, set, 'corrected')} | final ${avg(bench, set, 'final')}`)
  // 3. Where the latest articles differ most from their author.
  console.log('\nLargest gaps, FITNESS finals (text value vs the author\'s own):')
  for (const r of result.articles.filter((x: any) => x.bench === 'FITNESS')) console.log(`  ${r.author} ${String(r.title).slice(0, 30).padEnd(30)} ` + r.gaps.slice(0, 6).map((g: any) => `${g.feature} ${g.text.toFixed(2)} vs ${g.author.toFixed(2)}`).join(' · '))
}
const fmt = (s: any) => (s ? `${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)} (#${s.rank}, nearest ${s.nearest})` : '-')

async function judgePart() {
  const gemini = new GeminiAdapter()
  let cost = 0
  const call = async (prompt: string) => {
    const r = await gemini.call({ userPrompt: prompt, model: JUDGE_MODEL, temperature: 0, maxTokens: 3000, jsonMode: true, thinkingLevel: 'low' })
    cost += r.cost ?? 0
    return r.content
  }
  const masked: Record<string, string[]> = Object.fromEntries(Object.entries(pieces).map(([a, ps]) => [a, ps.map((p) => maskIdentity(p, MASK))]))
  // 1. Held-out real writing: two pieces per writer that the judge never sees as samples.
  const held: Array<{ author: string; text: string }> = []
  const lineupFor = (exclude?: { author: string; idx: number[] }): LineupCandidate[] => Object.entries(masked).map(([id, ps]) => ({ id, samples: exclude && exclude.author === id ? ps.filter((_, k) => !exclude.idx.includes(k)) : ps }))
  result.judgeOnRealWriting = []
  console.log('\nJudge on held-out pieces of REAL writing:')
  for (const [author, ps] of Object.entries(masked)) {
    const idx = ps.length >= 6 ? [1, ps.length - 2] : [ps.length - 1]
    for (const i of idx) {
      const r = await attribute({ text: ps[i], candidates: lineupFor({ author, idx }), call, votes: 2, seed: 100 + i })
      result.judgeOnRealWriting.push({ author, piece: i, winner: r.winner, firstPlaces: r.firstPlaces[author], votes: r.votes, meanPlace: r.meanPlace[author], noneFits: r.noneFits })
      console.log(`  ${author.padEnd(8)} piece ${String(i).padStart(2)} → ${r.winner.padEnd(8)} ${r.winner === author ? 'RIGHT' : 'wrong'} | own place ${r.meanPlace[author].toFixed(1)} | none-fits ${r.noneFits}/${r.votes}`)
      held.push({ author, text: ps[i] })
    }
  }
  const rr = result.judgeOnRealWriting
  console.log(`  ALL ${rr.filter((x: any) => x.winner === x.author).length}/${rr.length} right`)
  // 2. The finished bench articles.
  result.judgeOnArticles = []
  console.log('\nJudge on the finished bench articles:')
  for (const a of articles) {
    const author = authorOf(a)
    const r = await attribute({ text: maskIdentity(body(a.final), MASK), candidates: lineupFor(), call, votes: 2, seed: 7 })
    result.judgeOnArticles.push({ bench: benchOf(a), set: a.set, title: a.title, author, winner: r.winner, firstPlaces: r.firstPlaces, meanPlace: r.meanPlace, noneFits: r.noneFits, votes: r.votes, evidence: r.evidence })
    console.log(`  ${benchOf(a).padEnd(8)} ${author.padEnd(6)} ${String(a.title).slice(0, 34).padEnd(34)} → ${r.winner.padEnd(8)} ${r.winner === author ? 'RIGHT' : 'wrong'} | own place ${r.meanPlace[author].toFixed(1)} of ${Object.keys(masked).length} | none-fits ${r.noneFits}/${r.votes}`)
  }
  console.log(`\njudge cost $${cost.toFixed(3)}`)
  result.judgeCost = cost
}

async function main() {
  if (existsSync(OUT)) Object.assign(result, JSON.parse(readFileSync(OUT, 'utf8')), { material: result.material })
  if (MODE === 'score' || MODE === 'all') scorePart()
  if (MODE === 'judge' || MODE === 'all') await judgePart()
  writeFileSync(OUT, JSON.stringify(result, null, 1))
  await flushCallStats().catch(() => undefined)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
