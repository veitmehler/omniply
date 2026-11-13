/**
 * Gemini read of the Argon bench (2026-11-13) — prompt apply. Idempotent. OVERWRITES prompt text.
 *
 * What it changes, in one run, on whichever database DATABASE_URL points at:
 *   - steps 7, 8, 9, 11 (vertical 'default'): system + user prompt text from
 *     prisma/article-writer-prompts.ts (keywords as topics, no institution named
 *     as an authority, no textbook register, contraindications in the first
 *     person, no figure right after an experience line, own history once,
 *     reader kinds named at most twice, short contrasts at most twice, one
 *     completion check, no pronoun under a heading, research relevance line).
 *     Provider, model and maxTokens are left as they are on the target.
 *   - step 5 (vertical 'default', the search-intent intro): one rule appended so
 *     the intro stops printing the secondary keywords as typed (the writer
 *     rewrites the intro, but the strings were arriving in its brief).
 *   - pl_detect_section and pl_write_gloss (vertical 'default'): prompt text from
 *     prisma/plain-language-prompts.ts (never the title term, never inside a
 *     story sentence; one grammatical person, no hedge or disclaimer).
 *   - azavea rows are NOT touched (their text is derived separately).
 *
 * NOT run automatically anywhere. Run by hand, once per environment, with
 * Veit's explicit go:
 *   cd packages/db && set -a; . ./.env; set +a
 *   pnpm exec tsx scripts/apply-gemini-round-2026-11-13.ts            # dry run
 *   pnpm exec tsx scripts/apply-gemini-round-2026-11-13.ts --apply    # write
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
} from '../prisma/article-writer-prompts'
import { PLAIN_LANGUAGE_TEMPLATES } from '../prisma/plain-language-prompts'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const STEP_TEXT: Record<number, { systemPrompt: string; userPrompt: string }> = {
  7: { systemPrompt: RESEARCH_SYSTEM_PROMPT, userPrompt: FAQ_FACTS_USER_PROMPT },
  8: { systemPrompt: RESEARCH_SYSTEM_PROMPT, userPrompt: ARTICLE_FACTS_USER_PROMPT },
  9: { systemPrompt: WRITER_SYSTEM_PROMPT, userPrompt: WRITER_USER_PROMPT },
  11: { systemPrompt: EDITOR_SYSTEM_PROMPT, userPrompt: EDITOR_USER_PROMPT },
}

// Step 5 lives only in the database (reseed-prompts-v3 text); the rule is appended after its last task line.
const STEP5_ANCHOR = '4. DO NOT use italic type, bold type or quotation marks to highlight keywords. Just write plain text without highlighting.'
const STEP5_RULE =
  '\n\n5. The keywords are topics to cover, never phrases to print. The primary keyword appears once, in the words a person would say across the desk, paraphrased whenever it reads like a search query; the secondary keywords and entities are never printed as typed.'

async function main() {
  console.log(APPLY ? '⚠️  APPLY mode: prompt text will be overwritten.' : 'ℹ️  Dry run: showing what would change. Pass --apply to write.')

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

  const step5 = await prisma.promptTemplate.findUnique({ where: { stepNumber_vertical: { stepNumber: 5, vertical: 'default' } }, select: { id: true, userPrompt: true } })
  if (!step5) console.log('  ✗ step 5: no default row (skipped)')
  else if (step5.userPrompt.includes('never phrases to print')) console.log('  = step 5: keywords-as-topics rule present')
  else if (!step5.userPrompt.includes(STEP5_ANCHOR)) console.log('  ✗ step 5: anchor line not found, rule NOT added (text differs from the expected v1)')
  else {
    console.log('  ⤳ step 5: keywords-as-topics rule appended')
    if (APPLY) await prisma.promptTemplate.update({ where: { id: step5.id }, data: { userPrompt: step5.userPrompt.replace(STEP5_ANCHOR, STEP5_ANCHOR + STEP5_RULE) } })
  }

  for (const key of ['pl_detect_section', 'pl_write_gloss']) {
    const template = PLAIN_LANGUAGE_TEMPLATES.find((t) => t.key === key)
    if (!template) throw new Error(`template ${key} not found in plain-language-prompts.ts`)
    const row = await prisma.promptTemplate.findUnique({ where: { key_vertical: { key, vertical: 'default' } }, select: { id: true, systemPrompt: true, userPrompt: true } })
    if (!row) {
      console.log(`  ✗ ${key}: missing (seed-plain-language-prompts first)`)
      continue
    }
    const same = (row.systemPrompt ?? '') === (template.systemPrompt ?? '') && row.userPrompt === template.userPrompt
    console.log(`  ${same ? '=' : '⤳'} ${key}: system ${(row.systemPrompt ?? '').length} → ${(template.systemPrompt ?? '').length}, user ${row.userPrompt.length} → ${template.userPrompt.length}`)
    if (APPLY && !same) await prisma.promptTemplate.update({ where: { id: row.id }, data: { systemPrompt: template.systemPrompt, userPrompt: template.userPrompt } })
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
