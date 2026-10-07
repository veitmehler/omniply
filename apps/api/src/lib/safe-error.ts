/**
 * Client-safe error detail (2026-10-07 security cherry-picks, audit §B).
 *
 * The dashboard intentionally surfaces `details` from 500 responses in error
 * toasts, so blanket-genericizing them would break legitimate UX. Instead,
 * keep the human-useful part of the message and redact what turns a 500 into
 * a reconnaissance oracle: URLs (upstream fetch targets), IP addresses, and
 * filesystem paths. Full detail still goes to logs/Sentry at every call site.
 */
export function safeErrorDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/https?:\/\/[^\s"'<>)]+/gi, '[url]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[ip]')
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '[path]')
    .slice(0, 300)
}
