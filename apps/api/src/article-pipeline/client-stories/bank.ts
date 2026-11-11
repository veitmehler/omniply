/**
 * Story bank reads shared by the consumers (articles, social story arcs,
 * settings page). See beats.ts for how rows get in.
 */
import { prisma, accountIdForUser } from '@omniply/shared'

const MAX_NARRATOR_CHARS = 2400

/**
 * The narrator beats a social story arc may draw on: every sanitized bank row
 * for the user's account, most recent first, capped. Empty string when the
 * bank is empty (the caller falls back to the raw brand field for accounts
 * onboarded before the bank existed).
 */
export async function narratorBeatsForUser(userId: string): Promise<string> {
  const accountId = await accountIdForUser(userId)
  if (!accountId) return ''
  const rows = await prisma.clientStory.findMany({
    where: { accountId },
    orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    select: { storyText: true },
    take: 12,
  })
  let out = ''
  for (const r of rows) {
    if (out.length + r.storyText.length + 2 > MAX_NARRATOR_CHARS) break
    out += (out ? '\n\n' : '') + r.storyText.trim()
  }
  return out
}

export async function listStoriesForAccount(accountId: string) {
  return prisma.clientStory.findMany({
    where: { accountId },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, storyText: true, topicTags: true, source: true, kind: true, originalText: true, lastUsedAt: true, useCount: true, createdAt: true },
  })
}
