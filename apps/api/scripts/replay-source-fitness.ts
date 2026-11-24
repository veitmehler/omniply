/**
 * Replay the source-fitness checks over facts a finished bench already stored.
 * Writes no article and changes no data: it reads a dump of step-121 facts and
 * prints which sources would be rejected and which kept.
 *
 *   npx tsx apps/api/scripts/replay-source-fitness.ts <facts.json> <out.json>
 *
 * facts.json: { "<name>": { industry, title, facts: [{ fact, url, title, quote }] } }
 */
import { readFileSync, writeFileSync } from 'fs'
import { assessSource, type Assessment } from '../src/article-pipeline/source-fitness'
import { flushCallStats } from '../src/lib/net/call-stats'

interface Dump {
  [name: string]: { industry: string | null; title: string | null; facts: Array<{ fact: string; url: string; title: string; quote?: string }> }
}

async function main() {
  const [src, out] = process.argv.slice(2)
  const only = process.argv[4]
  const dump = JSON.parse(readFileSync(src, 'utf8')) as Dump
  const results: Array<{ article: string; url: string; title: string; facts: Array<{ fact: string; quote: string; use: string; reason: string | null }>; a: Assessment }> = []
  let cost = 0
  for (const [name, art] of Object.entries(dump)) {
    if (only && only !== name) continue
    const byUrl = new Map<string, Array<{ fact: string; quote: string; title: string }>>()
    for (const f of art.facts) {
      const list = byUrl.get(f.url) ?? []
      list.push({ fact: f.fact, quote: f.quote ?? '', title: f.title })
      byUrl.set(f.url, list)
    }
    const entries = [...byUrl.entries()]
    const CONCURRENCY = 4
    let next = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let i = next++; i < entries.length; i = next++) {
          const [url, facts] = entries[i]
          const a = await assessSource({ url, title: facts[0].title, practice: art.industry ?? '', topic: art.title ?? '', facts })
          cost += a.cost
          results.push({ article: name, url, title: a.meta.title, facts: facts.map((f, k) => ({ fact: f.fact, quote: f.quote, ...a.facts[k] })), a })
        }
      }),
    )
    const mine = results.filter((r) => r.article === name)
    const kept = mine.filter((r) => !r.a.rejected)
    const facts = mine.flatMap((r) => r.facts)
    console.log(`${name}: sources ${mine.length} → kept ${kept.length}, rejected ${mine.length - kept.length} | facts ${facts.length} → usable ${facts.filter((f) => f.use !== 'drop').length}`)
  }
  writeFileSync(out, JSON.stringify(results, null, 1))
  console.log(`cost $${cost.toFixed(4)} | written ${out}`)
  await flushCallStats().catch(() => undefined)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
