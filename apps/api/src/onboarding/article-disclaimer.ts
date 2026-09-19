/**
 * Once-per-clinic article footer disclaimer (Veit 2026-09-19).
 *
 * Rationale: the per-article step-18 generation gave every article a fresh
 * chance to flake (a live E2E shipped a mid-sentence truncation of the YMYL
 * disclaimer to WordPress). Legal boilerplate should be STABLE: generated
 * once at onboarding, validated, stored, client-editable in Settings, and
 * used verbatim on every publish. Azavea keeps its per-article variant
 * (different compliance posture, Veit decision).
 *
 * Reliability pattern mirrors diagram-style-gen: 3 attempts → admin alert —
 * but legal text additionally gets a DETERMINISTIC house fallback, so the
 * stored field is always populated after onboarding.
 */
import { prisma, brandSettingsForUser } from '@omniply/shared'
import { getSystemApiKey } from '../lib/system-keys'
import { logger } from '../lib/logger'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'
import { sendFailureAlert } from '../lib/alerts'

export const DISCLAIMER_MODEL = 'gemini-3-flash-preview'

/** Lawyer-safe static fallback — {industry} interpolated. Never shipped truncated. */
export function houseDisclaimer(industry: string): string {
  const field = industry?.trim() || 'health and wellness'
  return (
    `The information provided in this article is for educational and informational purposes only and is not intended as a substitute for professional medical advice, diagnosis, or treatment. ` +
    `Always seek the advice of your physician, ${field} professional, or other qualified health provider with any questions you may have regarding a medical condition, and never disregard professional medical advice or delay seeking it because of something you have read here. ` +
    `Individual results vary, and the practices described may not be appropriate for every person or situation. ` +
    `If you think you may have a medical emergency, call your doctor or emergency services immediately.`
  )
}

export function buildDisclaimerPrompt(industry: string, specialization?: string | null): string {
  const spec = specialization?.trim() ? ` with a focus on ${specialization.trim()}` : ''
  return `You are a legal compliance writer specializing in Google's YMYL (Your Money or Your Life) content standards.

Write ONE generic legal disclaimer for the article footer of a ${industry || 'health and wellness'} practice's website${spec}. It will appear unchanged at the bottom of EVERY educational article the practice publishes, so it must be fully generic — never reference any specific article, topic, or claim.

Requirements:
1. 2-3 short paragraphs, 500-1300 characters total.
2. States the content is educational/informational only and not a substitute for professional medical advice, diagnosis, or treatment.
3. Advises readers to consult their physician or qualified health provider, and never to disregard or delay professional advice because of the content.
4. Notes that individual results vary.
5. Includes an emergency line: seek immediate medical attention or call emergency services for emergencies.
6. Professional, calm, plain language. NO dashes as punctuation (no em or en dashes). No company or practice names. No headings, no markdown, no quotes around the text.

Return ONLY the disclaimer text.`
}

/** Validation gate — refuse anything that could embarrass a clinic legally. */
export function validateDisclaimer(text: string): string | null {
  const t = text.trim()
  if (t.length < 300) return `too short (${t.length})`
  if (t.length > 2500) return `too long (${t.length})`
  if (/```|^#|\*\*/m.test(t)) return 'contains markdown'
  if (/[—–]/.test(t)) return 'contains punctuation dashes'
  if (!/[.!?]$/.test(t)) return 'does not end with terminal punctuation'
  if (!/medical advice/i.test(t)) return 'missing the medical-advice clause'
  return null
}

export async function generateArticleDisclaimer(userId: string): Promise<string | null> {
  const acct = await prisma.user
    .findUnique({ where: { id: userId }, select: { account: { select: { vertical: true } } } })
    .catch(() => null)
  if (acct?.account?.vertical === 'azavea') return null // per-article variant stays

  const brand = await brandSettingsForUser(userId).catch(() => null)
  const industry = brand?.industry?.trim() || 'health and wellness'
  const specialization = brand?.specialization ?? null

  const geminiKey = await getSystemApiKey('gemini')
  let lastReason = 'no gemini key'
  if (geminiKey) {
    const prompt = buildDisclaimerPrompt(industry, specialization)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await instrumentCall({ provider: 'gemini', op: 'article-disclaimer-gen' }, () =>
          withTimeout(
            async (signal) => {
              const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${DISCLAIMER_MODEL}:generateContent?key=${geminiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.2 },
                  }),
                  signal,
                },
              )
              if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
              const data = (await res.json()) as {
                candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
              }
              return (data.candidates?.[0]?.content?.parts ?? [])
                .filter((p) => !p.thought)
                .map((p) => p.text ?? '')
                .join('')
                .trim()
            },
            60_000,
            'article-disclaimer-gen',
          ),
        )
        const invalid = validateDisclaimer(text)
        if (invalid) throw new Error(`validation: ${invalid}`)
        await prisma.brandSettings.updateMany({ where: { userId }, data: { articleDisclaimer: text } })
        logger.info({ userId, attempt, chars: text.length }, '[article-disclaimer] generated + stored')
        return text
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err)
        logger.warn({ userId, attempt, lastReason }, '[article-disclaimer] attempt failed')
      }
    }
  }

  // All attempts exhausted: store the deterministic house text (legal copy
  // must never be missing or truncated) and alert the admin.
  const fallback = houseDisclaimer(industry)
  await prisma.brandSettings.updateMany({ where: { userId }, data: { articleDisclaimer: fallback } })
  await sendFailureAlert({
    errorType: 'article_disclaimer_generation_failed',
    message:
      'Article disclaimer generation failed after 3 attempts — the static house disclaimer was stored. Review it in Settings and regenerate or edit as needed.',
    context: { userId, lastReason },
  }).catch((err) => logger.error({ userId, err }, '[article-disclaimer] failure alert send failed'))
  logger.warn({ userId, lastReason }, '[article-disclaimer] house fallback stored')
  return fallback
}
