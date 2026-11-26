/**
 * Author-voice plan, stage 2: store a built voice profile on an account.
 *
 * Reads a profile file written by scripts/voice-profiles.ts and writes it to
 * `voice_profiles` for one user, on whichever database DATABASE_URL points at.
 * The account's job title is taken from its brand settings.
 *
 * A stored profile does nothing until it is enabled. Without --enable the
 * account keeps the standard pipeline, and only a job forced on (a step-80
 * row, as the bench does) runs the voice path.
 *
 *   npx tsx --env-file=../../.env scripts/voice-profile-store.ts <profile.json> <userId> [--enable|--disable]
 */
import { readFileSync } from 'fs'
import { prisma, brandSettingsForUser } from '@omniply/shared'
import type { VoiceProfile } from '../src/lib/voice/profile'
import { renderAuthorVoice, renderAuthorVoiceShort, authorLimits } from '../src/lib/voice/render'
import { wordCount } from '../src/lib/voice/voice-score'

const [FILE, USER_ID] = process.argv.slice(2)
const flag = process.argv.includes('--enable') ? true : process.argv.includes('--disable') ? false : undefined

async function main() {
  if (!FILE || !USER_ID) throw new Error('usage: voice-profile-store.ts <profile.json> <userId> [--enable|--disable]')
  const profile = (JSON.parse(readFileSync(FILE, 'utf8')) as { profile: VoiceProfile }).profile
  const bs = await brandSettingsForUser(USER_ID)
  if (!bs) throw new Error(`no brand settings for user ${USER_ID}`)
  const onAccount = (bs.defaultAuthorName ?? '').trim()
  if (onAccount && onAccount.toLowerCase() !== profile.author.name.toLowerCase()) {
    // A bench account can hold another author's profile on purpose; say so plainly.
    console.log(`note: the account's author is "${onAccount}", the profile is for "${profile.author.name}"`)
  }
  profile.author.jobTitle = bs.defaultAuthorJobTitle ?? profile.author.jobTitle ?? null
  if (bs.defaultAuthorOwnWork?.trim() && !profile.identity.stated) profile.identity.stated = bs.defaultAuthorOwnWork.trim()
  const existing = await prisma.voiceProfile.findUnique({ where: { userId: USER_ID }, select: { enabled: true } })
  const enabled = flag ?? existing?.enabled ?? false
  await prisma.voiceProfile.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, profile: profile as unknown as object, version: profile.version, enabled },
    update: { profile: profile as unknown as object, version: profile.version, enabled, builtAt: new Date() },
  })
  console.log(
    `stored: ${profile.author.name} on ${USER_ID} | enabled ${enabled} | beliefs ${profile.beliefs.length}, stories ${profile.stories.length} | writer sees ${wordCount(renderAuthorVoice(profile))} words, a fixer ${wordCount(renderAuthorVoiceShort(profile))} | limits ${JSON.stringify(authorLimits(profile))}`,
  )
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
