/**
 * Source fitness round (2026-11-24) — prompt apply. Idempotent. OVERWRITES prompt text.
 *
 * What it changes, on whichever database DATABASE_URL points at:
 *   - step 9 (vertical 'default', the writer): system + user prompt text from
 *     prisma/article-writer-prompts.ts. One rule is new: a fact that research
 *     marks "(One study, in <group>.)" is stated as what happened to that
 *     group, never as a rule for everyone (Veit, 2026-11-24: a single trial is
 *     used only where the article describes that specific finding).
 *     Provider, model and maxTokens are left as they are on the target.
 *   - azavea rows are NOT touched (Azavea research is not vetted this way and
 *     never produces the bracket).
 *
 * NOT run automatically anywhere. Run by hand, once per environment:
 *   cd packages/db && set -a; . ./.env; set +a
 *   pnpm exec tsx scripts/apply-source-fitness-2026-11-24.ts            # dry run
 *   pnpm exec tsx scripts/apply-source-fitness-2026-11-24.ts --apply    # write
 */
import { PrismaClient } from '@prisma/client'
import { WRITER_SYSTEM_PROMPT, WRITER_USER_PROMPT } from '../prisma/article-writer-prompts'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '⚠️  APPLY mode: prompt text will be overwritten.' : 'ℹ️  Dry run: showing what would change. Pass --apply to write.')
  const row = await prisma.promptTemplate.findUnique({
    where: { stepNumber_vertical: { stepNumber: 9, vertical: 'default' } },
    select: { id: true, stepName: true, systemPrompt: true, userPrompt: true, defaultModel: true },
  })
  if (!row) {
    console.log('  ✗ step 9: no default row on this database (skipped; seed first)')
    return
  }
  const sameSys = (row.systemPrompt ?? '') === WRITER_SYSTEM_PROMPT
  const sameUsr = row.userPrompt === WRITER_USER_PROMPT
  console.log(`  ${sameSys && sameUsr ? '=' : '⤳'} step 9 (${row.stepName}, ${row.defaultModel}): system ${(row.systemPrompt ?? '').length} → ${WRITER_SYSTEM_PROMPT.length}, user ${row.userPrompt.length} → ${WRITER_USER_PROMPT.length}`)
  if (APPLY && !(sameSys && sameUsr)) {
    await prisma.promptTemplate.update({ where: { id: row.id }, data: { systemPrompt: WRITER_SYSTEM_PROMPT, userPrompt: WRITER_USER_PROMPT } })
  }
  console.log(APPLY ? '\nDone. The worker reads prompts per job, no restart needed.' : '\nDry run complete.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
