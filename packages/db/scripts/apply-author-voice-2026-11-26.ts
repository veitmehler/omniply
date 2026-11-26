/**
 * Author voice, stage 2 (2026-11-26): prompt apply. Idempotent. OVERWRITES prompt text.
 *
 * Creates or updates the eight `av_*` rows (vertical 'default') from
 * prisma/author-voice-prompts.ts on whichever database DATABASE_URL points at.
 * On an existing row only the prompt text is written; provider, model and
 * maxTokens stay as they are on the target, so a model change made there by
 * hand survives.
 *
 * These rows are read only by the voice path of the article pipeline, which
 * runs for an account with an enabled voice profile or for a job forced on.
 * No other prompt is touched.
 *
 * NOT run automatically anywhere. Run by hand, once per environment:
 *   cd packages/db && set -a; . ../../.env; set +a
 *   npx tsx scripts/apply-author-voice-2026-11-26.ts            # dry run
 *   npx tsx scripts/apply-author-voice-2026-11-26.ts --apply    # write
 */
import { PrismaClient } from '@prisma/client'
import { AUTHOR_VOICE_PROMPTS } from '../prisma/author-voice-prompts'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '⚠️  APPLY mode: prompt text will be written.' : 'ℹ️  Dry run: showing what would change. Pass --apply to write.')
  for (const p of AUTHOR_VOICE_PROMPTS) {
    const row = await prisma.promptTemplate.findUnique({ where: { key_vertical: { key: p.key, vertical: 'default' } }, select: { id: true, systemPrompt: true, userPrompt: true, defaultModel: true } })
    if (!row) {
      const taken = await prisma.promptTemplate.findUnique({ where: { stepNumber_vertical: { stepNumber: p.stepNumber, vertical: 'default' } }, select: { key: true, stepName: true } })
      if (taken) {
        console.log(`  ✗ ${p.key}: step number ${p.stepNumber} is already used by ${taken.key ?? taken.stepName} (skipped)`)
        continue
      }
      console.log(`  + ${p.key} (${p.stepNumber}, ${p.defaultModel}): system ${p.systemPrompt.length}, user ${p.userPrompt.length}`)
      if (APPLY) {
        await prisma.promptTemplate.create({
          data: { key: p.key, vertical: 'default', stepNumber: p.stepNumber, stepName: p.stepName, defaultProvider: p.defaultProvider, defaultModel: p.defaultModel, maxTokens: p.maxTokens, systemPrompt: p.systemPrompt, userPrompt: p.userPrompt, isActive: true },
        })
      }
      continue
    }
    const same = (row.systemPrompt ?? '') === p.systemPrompt && row.userPrompt === p.userPrompt
    console.log(`  ${same ? '=' : '⤳'} ${p.key} (${row.defaultModel}): system ${(row.systemPrompt ?? '').length} → ${p.systemPrompt.length}, user ${row.userPrompt.length} → ${p.userPrompt.length}`)
    if (APPLY && !same) await prisma.promptTemplate.update({ where: { id: row.id }, data: { systemPrompt: p.systemPrompt, userPrompt: p.userPrompt } })
  }
  console.log(APPLY ? '\nDone. The worker reads prompts per job, no restart needed.' : '\nDry run complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
