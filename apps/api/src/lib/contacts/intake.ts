/**
 * Contact-pipe intake (PMS framework v2 Phase C — one pipe, many feeders).
 *
 * Normalized demographics → GHL contact upsert. Feeders: PMS API pollers,
 * the CSV onboarding import, the periodic refresh upload, and (later) the
 * Jane Patients API. Idempotent: GHL's phone/email dedupe makes re-imports
 * safe, so "only new rows" is automatic.
 *
 * INVARIANTS (plan, non-negotiable): demographics only — name, phone,
 * email, tags. Tags are SERVICE tags (`pms-import-<source>`, appointment
 * events); synced patients are never added to marketing lists here.
 */
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { logger } from '../logger'
import { getGhlCredentials } from '../ghl/settings'
import { upsertGhlContact } from '../ghl/client'
import { splitFullName } from '../../agent/known'
import { normalizePhoneE164 } from '../../agent/phone'

export interface IntakeRow {
  name: string | null
  phone: string | null
  email: string | null
  /** Extra service tags beyond the source tag (e.g. appointment-completed). */
  tags?: string[]
}

export interface IntakeResult {
  processed: number
  upserted: number
  skipped: number
}

/** Upsert a batch of demographic rows into the account's GHL location. */
export async function intakeContacts(accountId: string, source: string, rows: IntakeRow[]): Promise<IntakeResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
  const ownerUserId = account?.ownerUserId
  if (!ownerUserId) throw new Error(`intakeContacts: account ${accountId} has no owner`)
  const creds = await getGhlCredentials(ownerUserId)
  if (!creds) throw new Error('No GHL credentials for account owner')
  const brand = await brandSettingsForUser(ownerUserId)
  const countryCode = brand?.organizationCountryCode ?? null

  const sourceTag = `pms-import-${source.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  let upserted = 0
  let skipped = 0
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase() || null
    const rawPhone = row.phone?.trim() || null
    const phone = rawPhone ? normalizePhoneE164(rawPhone, countryCode) : null
    if (!phone && !email) {
      skipped++
      continue
    }
    try {
      await upsertGhlContact(creds.apiKey, creds.locationId, {
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(row.name ? splitFullName(row.name) : {}),
        tags: [sourceTag, ...(row.tags ?? [])],
        source: `omniply-${sourceTag}`,
      })
      upserted++
    } catch (err) {
      skipped++
      logger.warn({ err, accountId, source }, '[contact-pipe] upsert failed for one row')
    }
  }
  logger.info({ accountId, source, processed: rows.length, upserted, skipped }, '[contact-pipe] intake complete')
  return { processed: rows.length, upserted, skipped }
}

/**
 * Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, commas, CRLF).
 * Returns rows of cells; no external dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/**
 * Header auto-mapping for PMS patient exports: finds name/phone/email
 * columns across the common header spellings (Cliniko, Jane, ChiroTouch,
 * generic). Returns null when no phone AND no email column exists.
 */
export function mapCsvToRows(csv: string[][]): { rows: IntakeRow[]; mapping: Record<string, number> } | null {
  if (csv.length < 2) return null
  const headers = csv[0].map((h) => h.trim().toLowerCase())
  const find = (...names: string[]) => headers.findIndex((h) => names.some((n) => h === n || h.includes(n)))
  const first = find('first name', 'first_name', 'firstname', 'given')
  const last = find('last name', 'last_name', 'lastname', 'surname', 'family')
  const full = find('full name', 'patient name', 'name')
  const phone = find('mobile', 'cell', 'phone')
  const email = find('email')
  if (phone === -1 && email === -1) return null

  const rows: IntakeRow[] = csv.slice(1).map((cells) => {
    const name =
      first !== -1 || last !== -1
        ? [first !== -1 ? cells[first] : '', last !== -1 ? cells[last] : ''].map((s) => s?.trim()).filter(Boolean).join(' ') || null
        : full !== -1
          ? cells[full]?.trim() || null
          : null
    return {
      name,
      phone: phone !== -1 ? cells[phone]?.trim() || null : null,
      email: email !== -1 ? cells[email]?.trim() || null : null,
    }
  })
  return { rows, mapping: { first, last, full, phone, email } }
}
