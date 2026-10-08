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

/**
 * GHL name fields from a possibly-full name ("Jack El Vecino" was landing
 * entirely in firstName, 2026-09-28): first token → firstName, the rest →
 * lastName (multi-word surnames stay intact).
 */
export function splitFullName(name: string): { firstName?: string; lastName?: string } {
  const trimmed = name.trim()
  if (!trimmed) return {}
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { firstName: trimmed }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
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
      case 'request_callback': {
        // Third-party callbacks (a spouse, a child) must NOT overwrite the
        // VISITOR's identity (C3 2026-10-08: after arranging Sarah's
        // callback, "what's my number?" answered with hers). Fold only when
        // the name matches the known visitor — or when nothing is known yet
        // (the callback establishes the primary identity).
        const n = str(a.name)
        const matchesVisitor = !known.name || !n || n.toLowerCase() === known.name.toLowerCase()
        if (matchesVisitor) {
          known.phone = str(a.phone) ?? known.phone
          known.name = n ?? known.name
        }
        break
      }
      case 'intake_details':
        known.phone = str(a.phone) ?? known.phone
        known.name = str(a.name) ?? known.name
        break
      // The booking action carries name+phone too — without this, a visitor
      // who only ever booked gets "I don't have your name" (C3 probe 11).
      case 'book_appointment':
        known.phone = str(a.phone) ?? known.phone
        known.name = str(a.name) ?? known.name
        break
      case 'add_contact_email':
        known.preferredEmail = str(a.email) ?? known.preferredEmail
        break
      // Silent corrections must update what the agent "knows" too, or it
      // would keep repeating the superseded details.
      case 'update_contact_details':
        known.phone = str(a.phone) ?? known.phone
        known.name = str(a.name) ?? known.name
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
