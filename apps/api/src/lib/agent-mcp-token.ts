/**
 * Per-clinic MCP token (plan: .plans/mcp-booking-endpoint Phase 2).
 *
 * Minted lazily wherever the discovery trail is published (schema head push,
 * linktree) and at provisioning for new accounts — so by the time an agent
 * reads a clinic's JSON-LD, the endpoint it advertises exists. Separate from
 * agentWidgetToken so it is independently revocable.
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '@omniply/shared'

const API_PUBLIC_BASE = (process.env.API_PUBLIC_URL ?? 'https://svc.omniply.io').replace(/\/$/, '')

export async function ensureAgentMcpToken(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { agentMcpToken: true },
  })
  if (account?.agentMcpToken) return account.agentMcpToken
  const token = randomBytes(24).toString('base64url')
  await prisma.account.update({ where: { id: accountId }, data: { agentMcpToken: token } })
  return token
}

/** Resolve a USER to their account's MCP endpoint URL (null when no account). */
export async function ensureAgentMcpUrl(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } })
  if (!user?.accountId) return null
  const token = await ensureAgentMcpToken(user.accountId)
  return `${API_PUBLIC_BASE}/mcp/${token}`
}
