/**
 * Author-voice plan, stage 2: a dry run of the voice path up to the writer.
 *
 * For one finished job (its research is reused) and one account with a stored
 * voice profile, this works out the author's take and the core facts, then
 * assembles the exact prompt the voice writer would receive, and writes all
 * three to a folder for a person to read.
 *
 * It WRITES NO ARTICLE and stores nothing: the writer is never called and no
 * pipeline step is saved. Two small model calls are made (the take and the
 * fact selection).
 *
 *   npx tsx --env-file=../../.env scripts/voice-dry-run.ts <sourceJobId> <userId> <out-dir>
 */
import { mkdirSync, writeFileSync } from 'fs'
import { prisma } from '@omniply/shared'
import { resolvePromptByKey } from '../src/lib/prompt-resolver'
import { runNewsletterPrompt } from '../src/newsletter/llm'
import { resolveVariables, type PipelineContext } from '../src/article-pipeline/variable-resolver'
import type { VoiceProfile } from '../src/lib/voice/profile'
import { authorLimits, authorSays, renderAuthorVoice, renderAuthorVoiceShort } from '../src/lib/voice/render'
import { wordCount } from '../src/lib/voice/voice-score'
import { coreStats, factsForSelector, outlineH2s, parseResearchFacts, parseSelection, renderCore, selectCore } from '../src/article-pipeline/voice/facts'
import { parseTake, renderTake, takeMaterial } from '../src/article-pipeline/voice/take'
import { flushCallStats } from '../src/lib/net/call-stats'

const [JOB, USER, OUT] = process.argv.slice(2)

async function main() {
  if (!JOB || !USER || !OUT) throw new Error('usage: voice-dry-run.ts <sourceJobId> <userId> <out-dir>')
  mkdirSync(OUT, { recursive: true })
  const job = await prisma.articleJob.findUniqueOrThrow({ where: { id: JOB }, include: { topic: true } })
  const row = await prisma.voiceProfile.findUnique({ where: { userId: USER } })
  if (!row) throw new Error('this account has no stored voice profile')
  const profile = row.profile as unknown as VoiceProfile
  const steps = await prisma.pipelineStep.findMany({ where: { jobId: JOB, status: 'completed' } })
  const ctx: PipelineContext = { jobId: JOB, userId: USER, topicId: job.topicId, topicText: job.topic.topic, topicSlug: job.topic.slug, completedSteps: new Map(steps.map((s) => [s.stepNumber, s.output ?? ''])), parsedSteps: new Map() }
  for (const n of [2, 12, 13]) {
    try {
      const raw = ctx.completedSteps.get(n)
      if (raw) ctx.parsedSteps.set(n, JSON.parse(raw))
    } catch {
      /* not JSON */
    }
  }
  // The writer must see nothing of the article that was already written for this job.
  for (const n of [9, 10, 11]) ctx.completedSteps.delete(n)

  const title = (ctx.completedSteps.get(0) ?? '').trim() || job.topic.topic
  const h2s = outlineH2s(ctx.completedSteps.get(4) ?? '')
  let cost = 0

  const m = takeMaterial(profile)
  const takeRun = await runNewsletterPrompt(
    'av_take',
    { author_name: profile.author.name, industry: profile.author.industry, practice: profile.author.practice, location: profile.author.location, beliefs: m.beliefs, stories: m.stories, habits: m.habits, title, topic: job.topic.topic, headings: h2s.map((h) => `- ${h}`).join('\n') },
    { userId: USER, jsonMode: true },
  )
  cost += takeRun.response.cost
  const take = parseTake(takeRun.content, profile, h2s)
  const takeText = renderTake(take, profile)

  const facts = parseResearchFacts(ctx.completedSteps.get(8), ctx.completedSteps.get(7))
  const selRun = await runNewsletterPrompt('av_fact_select', { title, headings: h2s.map((h) => `- ${h}`).join('\n'), position: take.hasPosition ? take.position : '(the author has stated no position on this topic)', facts: factsForSelector(facts) }, { userId: USER, jsonMode: true })
  cost += selRun.response.cost
  const picks = parseSelection(selRun.content)
  const core = selectCore(facts, picks, h2s)
  const coreText = renderCore(core)

  ctx.voice = { profile, full: renderAuthorVoice(profile), short: renderAuthorVoiceShort(profile), says: authorSays(profile), limits: authorLimits(profile), take, takeText, coreText }
  const template = await resolvePromptByKey('av_writer', { userId: USER })
  if (!template) throw new Error('av_writer prompt is not on this database')
  const system = await resolveVariables(template.systemPrompt ?? '', ctx)
  const user = await resolveVariables(template.userPrompt, ctx)
  const unresolved = [...`${system}\n${user}`.matchAll(/\{\{[^}]+\}\}/g)].map((x) => x[0])

  const slug = `${profile.author.name.toLowerCase().replace(/[^a-z]+/g, '-')}--${job.topic.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`
  writeFileSync(`${OUT}/${slug}.take.md`, `# ${profile.author.name}: take on "${job.topic.topic}"\n\n${takeText}\n`)
  writeFileSync(`${OUT}/${slug}.core-facts.md`, `# Core facts for "${job.topic.topic}" (${coreStats(core).core} of ${facts.length} researched)\n\n${coreText}\n`)
  writeFileSync(`${OUT}/${slug}.writer-prompt.md`, `# SYSTEM\n\n${system}\n\n# USER\n\n${user}\n`)
  console.log(`${profile.author.name} | ${job.topic.topic}`)
  console.log(`  take: position ${take.hasPosition}, beliefs ${take.beliefs.length}, myth ${take.myth !== null}, story ${take.story !== null}, section angles ${take.sections.length}/${h2s.length}`)
  console.log(`  facts: researched ${facts.length}, selector picked ${picks.reduce((n, p) => n + p.facts.length, 0)}, core ${JSON.stringify(coreStats(core))}, per section ${core.sections.map((s) => s.facts.length).join('/')}`)
  console.log(`  writer prompt: system ${wordCount(system)} words, user ${wordCount(user)} words (author's part ${wordCount(ctx.voice.full)}), unresolved placeholders: ${unresolved.length ? unresolved.join(' ') : 'none'}`)
  console.log(`  jurisdiction line: ${system.match(/advertising regulator in ([^\n]*?) will read/)?.[1] ?? '(not found)'}`)
  console.log(`  cost $${cost.toFixed(3)}`)
  await flushCallStats().catch(() => undefined)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    // The pipeline modules imported here keep handles open (queues, caches), so the script leaves explicitly.
    process.exit(process.exitCode ?? 0)
  })
