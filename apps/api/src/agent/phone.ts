/**
 * Country-aware E.164 phone normalization for agent → GHL writes.
 *
 * Why (live phone E2E 2026-09-09): a caller said "07 4489 2655" (Australian
 * landline) and GHL — whose location defaulted to US — stored it as
 * +10744892655, a number the front desk would misdial. GHL normalizes under
 * the LOCATION's country; we know the clinic's real country from brand
 * settings, so we normalize before the write and GHL stores it verbatim.
 *
 * Deliberately conservative: when the number doesn't match a shape we are
 * sure about, the cleaned digits pass through unchanged (today's behavior).
 * The verbatim spoken/typed number stays in the transcript either way.
 */

/** Countries we ship to: NANP + trunk-zero countries. Extend as markets open. */
const DIAL_CODES: Record<string, { code: string; trunkZero: boolean }> = {
  US: { code: '1', trunkZero: false },
  CA: { code: '1', trunkZero: false },
  AU: { code: '61', trunkZero: true },
  NZ: { code: '64', trunkZero: true },
  GB: { code: '44', trunkZero: true },
  IE: { code: '353', trunkZero: true },
  ZA: { code: '27', trunkZero: true },
  SG: { code: '65', trunkZero: false },
  DE: { code: '49', trunkZero: true },
  NL: { code: '31', trunkZero: true },
}

export function normalizePhoneE164(raw: string, countryCode: string | null | undefined): string {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (!digits) return raw

  // Already international.
  if (hasPlus) return `+${digits}`
  if (digits.startsWith('00') && digits.length > 8) return `+${digits.slice(2)}`

  const entry = countryCode ? DIAL_CODES[countryCode.toUpperCase()] : undefined
  if (!entry) return digits === trimmed ? trimmed : digits

  if (entry.code === '1') {
    // NANP: exactly 10 national digits, or 11 with the leading 1.
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    return digits
  }

  // Trunk-zero countries: drop one leading 0, prefix the dial code.
  const national = entry.trunkZero && digits.startsWith('0') ? digits.slice(1) : digits
  // Already entered with the dial code but no + (e.g. "61400111222").
  if (digits.startsWith(entry.code) && digits.length >= entry.code.length + 8) return `+${digits}`
  if (national.length >= 7 && national.length <= 12) return `+${entry.code}${national}`
  return digits
}
