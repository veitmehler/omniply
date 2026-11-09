/**
 * Consolidation round apply (2026-11-09). Idempotent. OVERWRITES prompt text.
 *
 * What it changes, in one run, on whichever database DATABASE_URL points at:
 *   - steps 7, 8, 9, 11 (vertical 'default'): system + user prompt text from
 *     prisma/article-writer-prompts.ts. Provider, model and maxTokens are
 *     left as they are on the target (staging runs Sonnet 5.5 via env override,
 *     prod 4.5; steps 7/8 run gemini-3.1-pro-preview live).
 *   - step 107 (key takeaways): prompt text from the same module.
 *   - step 110 (inline citations): the exact-URL rule (B13) if missing.
 *   - outline frameworks 1–12: bodies from prisma/outline-frameworks.ts
 *     (labels and descriptions untouched).
 *   - st_phrase_fix / st_presence_fix (422 / 423): created if missing.
 *
 * NOT run automatically anywhere. Run by hand, once per environment, with
 * Veit's explicit go:
 *   cd packages/db && set -a; . ./.env; set +a
 *   pnpm exec tsx scripts/apply-consolidation-2026-11.ts            # dry run (diff sizes only)
 *   pnpm exec tsx scripts/apply-consolidation-2026-11.ts --apply    # write
 */
import { PrismaClient } from '@prisma/client'
import {
  WRITER_SYSTEM_PROMPT,
  WRITER_USER_PROMPT,
  EDITOR_SYSTEM_PROMPT,
  EDITOR_USER_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  FAQ_FACTS_USER_PROMPT,
  ARTICLE_FACTS_USER_PROMPT,
  KEY_TAKEAWAYS_SYSTEM_PROMPT,
  KEY_TAKEAWAYS_USER_PROMPT,
} from '../prisma/article-writer-prompts'
import { OUTLINE_FRAMEWORKS } from '../prisma/outline-frameworks'
import { DEAI_TEMPLATES } from '../prisma/deai-prompts'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const STEP_TEXT: Record<number, { systemPrompt: string; userPrompt: string }> = {
  7: { systemPrompt: RESEARCH_SYSTEM_PROMPT, userPrompt: FAQ_FACTS_USER_PROMPT },
  8: { systemPrompt: RESEARCH_SYSTEM_PROMPT, userPrompt: ARTICLE_FACTS_USER_PROMPT },
  9: { systemPrompt: WRITER_SYSTEM_PROMPT, userPrompt: WRITER_USER_PROMPT },
  11: { systemPrompt: EDITOR_SYSTEM_PROMPT, userPrompt: EDITOR_USER_PROMPT },
  107: { systemPrompt: KEY_TAKEAWAYS_SYSTEM_PROMPT, userPrompt: KEY_TAKEAWAYS_USER_PROMPT },
}

const STEP110_ANCHOR = '- Each citation URL must appear AT MOST ONCE in the entire article.\n'
const STEP110_RULE =
  '- Use ONLY the URLs in the Validated Citations JSON, copied EXACTLY, character for character. Never alter, shorten, "correct" or invent a URL. A URL that has no matching passage is skipped, never replaced with another.\n'

async function main() {
  console.log(APPLY ? '⚠️  APPLY mode: prompt text and framework bodies will be overwritten.' : 'ℹ️  Dry run: showing what would change. Pass --apply to write.')

  for (const [stepStr, text] of Object.entries(STEP_TEXT)) {
    const stepNumber = Number(stepStr)
    const row = await prisma.promptTemplate.findUnique({
      where: { stepNumber_vertical: { stepNumber, vertical: 'default' } },
      select: { id: true, stepName: true, systemPrompt: true, userPrompt: true, defaultModel: true },
    })
    if (!row) {
      console.log(`  ✗ step ${stepNumber}: no default row on this database (skipped; seed first)`)
      continue
    }
    const sameSys = (row.systemPrompt ?? '') === text.systemPrompt
    const sameUsr = row.userPrompt === text.userPrompt
    console.log(
      `  ${sameSys && sameUsr ? '=' : '⤳'} step ${stepNumber} (${row.stepName}, ${row.defaultModel}): system ${(row.systemPrompt ?? '').length} → ${text.systemPrompt.length}, user ${row.userPrompt.length} → ${text.userPrompt.length}`,
    )
    if (APPLY && !(sameSys && sameUsr)) {
      await prisma.promptTemplate.update({ where: { id: row.id }, data: { systemPrompt: text.systemPrompt, userPrompt: text.userPrompt } })
    }
  }

  const rows110 = await prisma.promptTemplate.findMany({ where: { stepNumber: 110 }, select: { id: true, vertical: true, userPrompt: true } })
  for (const r of rows110) {
    const has = r.userPrompt.includes('copied EXACTLY')
    console.log(`  ${has ? '=' : '⤳'} step 110 [${r.vertical}]: exact-URL rule ${has ? 'present' : 'missing'}`)
    if (APPLY && !has && r.userPrompt.includes(STEP110_ANCHOR)) {
      await prisma.promptTemplate.update({ where: { id: r.id }, data: { userPrompt: r.userPrompt.replace(STEP110_ANCHOR, STEP110_ANCHOR + STEP110_RULE) } })
    }
  }

  for (const fw of OUTLINE_FRAMEWORKS) {
    const row = await prisma.outlineFramework.findUnique({ where: { number: fw.number }, select: { id: true, body: true, label: true } })
    if (!row) {
      console.log(`  ✗ framework ${fw.number}: missing (would be created)`)
      if (APPLY) await prisma.outlineFramework.create({ data: { number: fw.number, label: fw.label, description: fw.description, body: fw.body } })
      continue
    }
    const same = row.body === fw.body
    console.log(`  ${same ? '=' : '⤳'} framework ${fw.number} (${row.label}): body ${row.body.length} → ${fw.body.length}`)
    if (APPLY && !same) await prisma.outlineFramework.update({ where: { id: row.id }, data: { body: fw.body } })
  }

  for (const key of ['st_phrase_fix', 'st_presence_fix']) {
    const template = DEAI_TEMPLATES.find((t) => t.key === key)
    if (!template) throw new Error(`template ${key} not found in deai-prompts.ts`)
    const existing = await prisma.promptTemplate.findUnique({ where: { key_vertical: { key, vertical: 'default' } }, select: { id: true } })
    console.log(`  ${existing ? '=' : '+'} ${key}: ${existing ? 'exists' : 'would be created'}`)
    if (APPLY && !existing) await prisma.promptTemplate.create({ data: template })
  }

  console.log(APPLY ? '\nDone. Remember: the worker reads prompts per job, no restart needed.' : '\nDry run complete.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
