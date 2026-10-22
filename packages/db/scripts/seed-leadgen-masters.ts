/**
 * Seed the real master library (leadgen master-library plan Phase E).
 *
 * Seeds/updates the five converted masters as ACTIVE templates and deactivates
 * the demo template. Guard: rejects any spec whose non-SVG HTML contains an
 * em/en dash — masters are the rewrite-guard fallback, so they must comply
 * with the de-AI rule themselves.
 *
 * Run: pnpm --filter @omniply/db exec tsx scripts/seed-leadgen-masters.ts
 */
import { PrismaClient } from '@prisma/client'
import { buildMasterHtml, defaultSlotMeta, type MasterDocSpec } from '../../../apps/api/src/leadgen/master-layout'
import { spec as deskWorkers } from './leadgen-masters/01-desk-workers'
import { spec as painWarning } from './leadgen-masters/02-pain-warning-sign'
import { spec as morningHabits } from './leadgen-masters/03-morning-habits'
import { spec as betterSleep } from './leadgen-masters/04-better-sleep'
import { spec as firstVisit } from './leadgen-masters/05-first-visit'
import { spec as everydayStrength } from './leadgen-masters/06-everyday-strength'
import { spec as wellnessSleep } from './leadgen-masters/07-better-sleep'
import { spec as switchOff } from './leadgen-masters/08-switch-off'
import { spec as everydayFuel } from './leadgen-masters/09-everyday-fuel'
import { spec as firstWellnessVisit } from './leadgen-masters/10-first-wellness-visit'
import { buildReviewCardHtml } from '../../../apps/api/src/leadgen/review-card'

const prisma = new PrismaClient()

// vertical gates which accounts compile the master at onboarding
// ('chiro' | 'wellness' | 'all'). Wellness slugs must match
// GUIDE_SLUG_BY_PILLAR in apps/api/src/age-check/generate.ts.
const MASTERS: { slug: string; description: string; vertical: string; spec: MasterDocSpec }[] = [
  { slug: 'desk-workers-survival-guide', description: 'Desk workers: setup, rhythm, 6 stretches', vertical: 'chiro', spec: deskWorkers },
  { slug: 'pain-normal-or-warning-sign', description: 'Pain triage: traffic light, red flags, body map, diary', vertical: 'chiro', spec: painWarning },
  { slug: 'morning-habits-spine', description: '7 morning habit swaps that protect the spine', vertical: 'chiro', spec: morningHabits },
  { slug: 'better-sleep-without-pills', description: 'Sleep position, pillow, mattress + wind-down', vertical: 'chiro', spec: betterSleep },
  { slug: 'first-chiropractic-visit', description: 'First-visit walkthrough, myths vs facts, questions to ask', vertical: 'chiro', spec: firstVisit },
  { slug: 'everyday-strength-guide', description: 'Wellness: 5 movements, 20-minute week, lighter-load options', vertical: 'wellness', spec: everydayStrength },
  { slug: 'better-sleep-guide', description: 'Wellness: consistency, light, bedroom, 60-minute wind-down', vertical: 'wellness', spec: wellnessSleep },
  { slug: 'switch-off-guide', description: 'Wellness: micro-pauses, digital sunset, protected hour', vertical: 'wellness', spec: switchOff },
  { slug: 'everyday-fuel-guide', description: 'Wellness: half-plate, hydration, caffeine/alcohol timing, rhythm', vertical: 'wellness', spec: everydayFuel },
  { slug: 'first-wellness-visit', description: 'Wellness: first-visit walkthrough, what sessions feel like, myths, questions', vertical: 'wellness', spec: firstWellnessVisit },
]

/** Dashes are forbidden in master TEXT; SVG path data is exempt. */
function assertDashFree(slug: string, html: string): void {
  const withoutSvg = html.replace(/<svg[\s\S]*?<\/svg>/g, '')
  const hit = withoutSvg.match(/[—–]/)
  if (hit) {
    const at = withoutSvg.indexOf(hit[0])
    throw new Error(`${slug}: em/en dash in master text near "…${withoutSvg.slice(Math.max(0, at - 60), at + 60)}…"`)
  }
}

async function main() {
  for (const m of MASTERS) {
    const sourceHtml = buildMasterHtml(m.spec)
    assertDashFree(m.slug, sourceHtml)
    const t = await prisma.leadGenTemplate.upsert({
      where: { slug: m.slug },
      create: {
        name: m.spec.title,
        slug: m.slug,
        description: m.description,
        sourceHtml,
        slotMeta: defaultSlotMeta(m.spec),
        vertical: m.vertical,
        active: true,
      },
      update: {
        name: m.spec.title,
        description: m.description,
        sourceHtml,
        slotMeta: defaultSlotMeta(m.spec),
        vertical: m.vertical,
        active: true,
      },
    })
    console.log(`seeded ${m.slug} [${m.vertical}] (${t.id}) — ${Math.round(sourceHtml.length / 1024)}KB`)
  }
  // Master #6: the QR review counter card (Phase F) — special compile path,
  // flagged via slotMeta.__kind; fixed copy, no rewrite slots.
  const cardHtml = buildReviewCardHtml()
  assertDashFree('review-counter-card', cardHtml)
  const card = await prisma.leadGenTemplate.upsert({
    where: { slug: 'review-counter-card' },
    create: {
      name: 'Review Counter Card (QR)',
      slug: 'review-counter-card',
      description: 'A6 front-desk card: scan to leave a Google review',
      sourceHtml: cardHtml,
      slotMeta: { __kind: 'review_card' },
      vertical: 'all', // QR review card works for any local business
      active: true,
    },
    update: { sourceHtml: cardHtml, slotMeta: { __kind: 'review_card' }, vertical: 'all', active: true },
  })
  console.log(`seeded review-counter-card (${card.id})`)

  const demo = await prisma.leadGenTemplate.updateMany({
    where: { slug: 'demo-desk-back-routine' },
    data: { active: false },
  })
  if (demo.count) console.log('demo template deactivated')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
