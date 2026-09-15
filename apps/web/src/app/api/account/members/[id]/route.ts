import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@omniply/shared'
import { getOrCreateUser } from '@/lib/user'

type Ctx = { params: Promise<{ id: string }> }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// PATCH /api/account/members/:id { email?, name? } — email editable only while Pending.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const clerkId = await resolveClerkId()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await getOrCreateUser(clerkId)
  if (!me.accountId) return NextResponse.json({ error: 'No account' }, { status: 500 })

  const { id } = await params
  const member = await prisma.accountMember.findUnique({ where: { id } })
  if (!member || member.accountId !== me.accountId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const data: { name?: string | null; email?: string } = {}
  if ('name' in body) data.name = body.name ? String(body.name).trim() : null
  if ('email' in body) {
    const active = await prisma.user.findFirst({ where: { email: member.email, accountId: me.accountId }, select: { id: true } })
    if (active) return NextResponse.json({ error: "This member has signed up — their email can't be changed here." }, { status: 409 })
    const email = String(body.email).trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    const clash = await prisma.accountMember.findUnique({ where: { email } })
    if (clash && clash.id !== id) return NextResponse.json({ error: 'That email is already on a team.' }, { status: 409 })
    data.email = email
  }

  const updated = await prisma.accountMember.update({ where: { id }, data })
  return NextResponse.json({ member: updated })
}

// DELETE /api/account/members/:id — remove from roster; move an active user to a solo account.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const clerkId = await resolveClerkId()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await getOrCreateUser(clerkId)
  if (!me.accountId) return NextResponse.json({ error: 'No account' }, { status: 500 })

  const { id } = await params
  const member = await prisma.accountMember.findUnique({ where: { id } })
  if (!member || member.accountId !== me.accountId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  await prisma.accountMember.delete({ where: { id } })

  // Revoke the pending Clerk invitation, if any.
  if (member.clerkInvitationId) {
    await (await clerkClient()).invitations.revokeInvitation(member.clerkInvitationId).catch(() => {})
  }

  // If the member had signed up, move them to a fresh solo account.
  const user = await prisma.user.findFirst({ where: { email: member.email, accountId: me.accountId }, select: { id: true, name: true } })
  if (user) {
    const solo = await prisma.account.create({ data: { name: user.name, ownerUserId: user.id } })
    await prisma.user.update({ where: { id: user.id }, data: { accountId: solo.id } })
  }

  return NextResponse.json({ ok: true })
}
