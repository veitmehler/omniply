import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma, ACCOUNT_SEAT_LIMIT } from '@omniply/shared'
import { getOrCreateUser } from '@/lib/user'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// POST /api/account/members { email, name? } — add a teammate.
// Public sign-ups are closed, so we create a Clerk invitation for the email
// (Clerk emails a set-password link; we also keep the link for the owner to
// copy). On accept, the roster email-match joins them to this account.
export async function POST(request: NextRequest) {
  const clerkId = await resolveClerkId()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const me = await getOrCreateUser(clerkId)
  if (!me.accountId) return NextResponse.json({ error: 'No account' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const email = body?.email ? String(body.email).trim().toLowerCase() : ''
  const name = body?.name ? String(body.name).trim() : null
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (email === me.email.toLowerCase()) return NextResponse.json({ error: "That's your own email." }, { status: 400 })

  const rosterCount = await prisma.accountMember.count({ where: { accountId: me.accountId } })
  if (rosterCount >= ACCOUNT_SEAT_LIMIT - 1) {
    return NextResponse.json({ error: `Your account is limited to ${ACCOUNT_SEAT_LIMIT} users.` }, { status: 409 })
  }
  const existingRoster = await prisma.accountMember.findUnique({ where: { email } })
  if (existingRoster) {
    return NextResponse.json(
      { error: existingRoster.accountId === me.accountId ? 'Already on your team.' : 'That email is already on another team.' },
      { status: 409 },
    )
  }

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true, accountId: true } })

  let clerkInvitationId: string | null = null
  let inviteUrl: string | null = null
  // Only invite people who don't already have an account.
  if (!existingUser) {
    const origin = new URL(request.url).origin
    try {
      const inv = await (await clerkClient()).invitations.createInvitation({
        emailAddress: email,
        redirectUrl: `${origin}/sign-up`,
        publicMetadata: { accountId: me.accountId },
        ignoreExisting: true,
      })
      clerkInvitationId = inv.id
      inviteUrl = (inv as { url?: string }).url ?? null
    } catch (err) {
      console.error('[account/members] createInvitation failed:', err)
      return NextResponse.json({ error: 'Failed to create the invitation. Try again.' }, { status: 502 })
    }
  }

  const member = await prisma.accountMember.create({
    data: { accountId: me.accountId, email, name, clerkInvitationId, inviteUrl },
  })

  // If they already have a user, move them into this account right away.
  if (existingUser && existingUser.accountId !== me.accountId) {
    const old = existingUser.accountId
    await prisma.user.update({ where: { id: existingUser.id }, data: { accountId: me.accountId } })
    if (old) {
      const remaining = await prisma.user.count({ where: { accountId: old } })
      if (remaining === 0) await prisma.account.delete({ where: { id: old } }).catch(() => {})
    }
  }

  return NextResponse.json({ member })
}
