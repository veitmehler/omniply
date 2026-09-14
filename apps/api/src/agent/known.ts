/**
 * Known visitor details for a conversation (contact-convergence batch).
 *
 * Derived from the conversation's PERSISTED validated actions — never from raw
 * chat text — so the engine can confirm instead of re-asking ("we'll email you
 * at X if we can't reach you — or is another address better?") and so every
 * GHL write after the first converges on one contact.
 *
 * Email semantics (user-locked): the add_contact_email address is a considered
 * choice for real communication and becomes the contact's PRIMARY email; the
 * capture email is the lead-gen address (Drive grant + drip already fired to
 * it) and only fills the primary slot while no preferred address exists.
 */
import { prisma } from '@omniply/shared'

export interface KnownDetails {
  name: string | null
  phone: string | null
  /** Lead-gen email from capture_contact (guide flow). */
  leadEmail: string | null
  /** Deliberately-chosen email from add_contact_email — always wins. */
  preferredEmail: string | null
}

/** The email that should sit in the contact's primary slot right now. */
export function primaryEmailOf(k: KnownDetails): string | null {
  return k.preferredEmail ?? k.leadEmail
}

export async function knownDetailsFor(conversationId: string): Promise<KnownDetails> {
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { action: true },
  })
  const known: KnownDetails = { name: null, phone: null, leadEmail: null, preferredEmail: null }
  for (const row of rows) {
    const a = row.action as Record<string, unknown> | null
    if (!a || typeof a.type !== 'string') continue
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    switch (a.type) {
      case 'capture_contact':
        known.leadEmail = str(a.email) ?? known.leadEmail
        known.name = str(a.name) ?? known.name
        known.phone = str(a.phone) ?? known.phone
        break
      case 'request_callback':
        known.phone = str(a.phone) ?? known.phone
        known.name = str(a.name) ?? known.name
        break
      case 'intake_details':
        known.phone = str(a.phone) ?? known.phone
        known.name = str(a.name) ?? known.name
        break
      case 'add_contact_email':
        known.preferredEmail = str(a.email) ?? known.preferredEmail
        break
    }
  }
  return known
}

/** Prompt-injectable block; empty string when nothing is known yet. */
export function knownDetailsPromptBlock(k: KnownDetails): string {
  const lines: string[] = []
  if (k.name) lines.push(`Name: ${k.name}`)
  if (k.phone) lines.push(`Phone: ${k.phone}`)
  const email = primaryEmailOf(k)
  if (email) lines.push(`Email on file: ${email}`)
  if (!lines.length) return '(nothing captured yet)'
  return lines.join('\n')
}
