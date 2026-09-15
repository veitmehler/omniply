import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { prisma, ACCOUNT_SEAT_LIMIT } from '@omniply/shared'
import { getOrCreateUser } from '@/lib/user'

// GET /api/account — team overview (owner + roster, no invitations)
export async function GET() {
  const clerkId = await resolveClerkId()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const me = await getOrCreateUser(clerkId)
  if (!me.accountId) return NextResponse.json({ error: 'No account' }, { status: 500 })

  const [account, roster, users] = await Promise.all([
    prisma.account.findUnique({ where: { id: me.accountId } }),
    prisma.accountMember.findMany({ where: { accountId: me.accountId }, orderBy: { createdAt: 'asc' } }),
    prisma.user.findMany({ where: { accountId: me.accountId }, select: { id: true, email: true, name: true } }),
  ])
  const activeEmails = new Set(users.map((u) => u.email.toLowerCase()))
  const owner = users.find((u) => u.id === account?.ownerUserId)

  return NextResponse.json({
    account: { id: me.accountId, name: account?.name ?? null, assistantEmail: account?.assistantEmail ?? null },
    owner: owner ? { email: owner.email, name: owner.name } : null,
    members: roster.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      status: activeEmails.has(r.email.toLowerCase()) ? 'active' : 'pending',
      inviteUrl: r.inviteUrl,
    })),
    seatLimit: ACCOUNT_SEAT_LIMIT,
    seatsUsed: 1 + roster.length, // owner + roster
  })
}

// PATCH /api/account — update account name
export async function PATCH(request: NextRequest) {
  const clerkId = await resolveClerkId()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const me = await getOrCreateUser(clerkId)
  if (!me.accountId) return NextResponse.json({ error: 'No account' }, { status: 500 })

  const body = await request.json()
  const data: { name?: string | null } = {}
  if ('name' in body) data.name = body.name ? String(body.name).trim() : null

  const account = await prisma.account.update({ where: { id: me.accountId }, data })
  return NextResponse.json({ name: account.name })
}
