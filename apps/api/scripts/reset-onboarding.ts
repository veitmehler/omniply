/**
 * Reset an account's ONBOARDING to a clean pre-run state (test accounts!).
 *
 * Deletes the onboarding PRODUCTS while keeping the account plumbing:
 *   cleared — OnboardingSession, BrandSettings, Settings.writingStyle,
 *             NewsletterOffer rows, Account.onboardingCompletedAt,
 *             S3 voice recordings (onboarding/<account>/voice/)
 *   kept    — Account, User, GhlSettings (tokens/OAuth), WordPressConnection,
 *             calendars (finale routing re-finds them), LeadGenDocuments
 *             (the finale recompiles them back to pending_review)
 *
 * Usage (inside the api container):
 *   /app/node_modules/.bin/tsx /app/scripts/reset-onboarding.ts <accountId> --yes
 */
import { prisma, deleteS3Prefix } from '@omniply/shared'

async function main() {
  const accountId = process.argv[2]
  const confirmed = process.argv.includes('--yes')
  if (!accountId) throw new Error('usage: reset-onboarding.ts <accountId> --yes')

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, onboardingCompletedAt: true },
  })
  if (!account) throw new Error(`no account ${accountId}`)
  const users = await prisma.user.findMany({ where: { accountId }, select: { id: true, email: true } })
  console.log(`Account: ${account.name} (${account.id}) — ${users.length} user(s)`)
  if (!confirmed) {
    console.log('DRY RUN — pass --yes to execute. Would clear: session, brand settings,')
    console.log('writing style, newsletter offers, onboardingCompletedAt, S3 voice audio.')
    process.exit(0)
  }

  const userIds = users.map((u) => u.id)
  const offers = await prisma.newsletterOffer.deleteMany({ where: { userId: { in: userIds } } })
  const brand = await prisma.brandSettings.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.settings.updateMany({ where: { userId: { in: userIds } }, data: { writingStyle: null } })
  const session = await prisma.onboardingSession.deleteMany({ where: { accountId } })
  await prisma.account.update({ where: { id: accountId }, data: { onboardingCompletedAt: null } })
  await deleteS3Prefix(`onboarding/${accountId}/voice/`).catch((e: unknown) =>
    console.warn('voice-audio cleanup failed (non-fatal):', e instanceof Error ? e.message : e),
  )

  console.log(
    `RESET DONE — session:${session.count} brand:${brand.count} offers:${offers.count}; ` +
      'onboardingCompletedAt=null; voice audio cleared. Reopen the embed to start fresh.',
  )
  process.exit(0)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
