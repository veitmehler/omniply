/**
 * Onboarding synthesis services (onboarding plan Phases 4–5).
 *
 * Brand-profile synthesis (crawl facts × the five spoken answers), writing-
 * voice analysis (spoken-register transcripts + a real article, labeled so the
 * analyzer borrows the personality, not the grammar), the seasonal offer
 * calendar, CTA drafts, and the lightweight branded template preview that
 * powers "the reveal". All Gemini flash JSON calls — cheap, structured,
 * instrumented.
 */
import { logger } from '../lib/logger'
import { instrumentCall } from '../lib/net/instrument'
import { withTimeout } from '../lib/net/with-timeout'
import type { SemanticPalette, SpecializationDraft } from './site-analysis'
import { nlLabelColorFor } from './palette-compose'

const MODEL = 'gemini-3-flash-preview'

async function geminiJson<T>(apiKey: string, prompt: string, op: string, temperature = 0.4): Promise<T> {
  const res = await instrumentCall({ provider: 'gemini', op }, () =>
    withTimeout(
      (signal) =>
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature },
          }),
          signal,
        }),
      90_000,
      op,
    ),
  )
  if (!res.ok) throw new Error(`gemini ${op} HTTP ${res.status}`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  return JSON.parse(text) as T
}

export interface BrandProfileDraft {
  businessDescription: string
  who: string
  ourExperience: string
  articleGoal: string
  specialInstructions: string
  industry: string
  primarySpecialization?: string
  specializations?: string[]
}

export interface VoiceAnswers {
  declaration?: string
  enemy?: string
  tribe?: string
  line?: string
  proof?: string
}

export async function synthesizeBrandProfile(
  apiKey: string,
  corpus: string,
  answers: VoiceAnswers,
  specializationDraft: SpecializationDraft | null,
): Promise<BrandProfileDraft> {
  return geminiJson<BrandProfileDraft>(
    apiKey,
    `You are building the Brand Profile that will drive ALL content generation (articles, newsletters, social) for a healthcare practice. Combine the FACTS from their website with the SOUL from the owner's spoken answers.

WEBSITE FACTS (crawled):
${corpus.slice(0, 15_000) || '(no website text available)'}

DETECTED CLASSIFICATION: ${JSON.stringify(specializationDraft ?? {})}

OWNER'S SPOKEN ANSWERS (verbatim transcripts — mine these for personality, stance and specifics):
1. What patients should say about them in 3 years: ${answers.declaration ?? '(skipped)'}
2. What drives them crazy in their industry: ${answers.enemy ?? '(skipped)'}
3. Their favorite patient: ${answers.tribe ?? '(skipped)'}
4. What they refuse to compromise on: ${answers.line ?? '(skipped)'}
5. What the first visit/month looks like: ${answers.proof ?? '(skipped)'}

Return STRICT JSON:
{
 "businessDescription": "2-3 sentences: what the practice does and for whom — concrete, no marketing fluff",
 "who": "3-4 sentences describing the target patient. Start from answer 3, then ENRICH with the website: mine the services/conditions/treatments pages for the specific problems, demographics, occupations and life situations the site targets (desk workers, athletes, young families, seniors…) — the richer and more specific, the better every downstream article targets them",
 "ourExperience": "2-3 sentences of practitioner experience/process (from answer 5 + credentials found on the site)",
 "articleGoal": "1-2 sentences: what each article should achieve for the reader and the practice (from answer 1)",
 "specialInstructions": "Editorial stance distilled from answers 2 and 4: what the content should consistently push against and stand for. CRITICAL: phrase as critique of PRACTICES/patterns, never named competitors, and no therapeutic-outcome claims (AHPRA-safe).",
 "industry": "e.g. Chiropractor",
 "primarySpecialization": "keep from detected classification unless the answers clearly contradict it",
 "specializations": ["..."]
}`,
    'onboarding.brand_profile',
  )
}

export async function generateWritingStyle(
  apiKey: string,
  transcripts: string,
  articleSample: string | null,
): Promise<string> {
  const result = await geminiJson<{ writingStyle: string }>(
    apiKey,
    `You are an expert writing analyst. Produce a reusable writing-style instruction (exactly 2 paragraphs, plain text) that lets an AI write as this person.

SOURCE A — SPOKEN TRANSCRIPTS (spoken register: borrow the PERSONALITY — vocabulary, warmth, opinions, rhythm — NOT the grammar or filler):
${transcripts.slice(0, 8000)}

${articleSample ? `SOURCE B — REAL WRITTEN SAMPLE (borrow the written register: structure, sentence discipline, formatting habits):\n${articleSample.slice(0, 12_000)}` : 'SOURCE B: none — derive written register conservatively from the spoken material (professional, clear, warm).'}

Return STRICT JSON: {"writingStyle": "two paragraphs of style instructions, no meta-commentary"}`,
    'onboarding.writing_style',
    0.3,
  )
  return result.writingStyle
}

export interface OfferDraft {
  title: string
  body: string
  ctaLabel: string
  month?: number // 1-12; absent = evergreen
}

export async function generateOfferDrafts(
  apiKey: string,
  profile: BrandProfileDraft,
  hemisphere: 'north' | 'south',
): Promise<OfferDraft[]> {
  const result = await geminiJson<{ offers: OfferDraft[] }>(
    apiKey,
    `Create a 12-month seasonal offer calendar plus 2 evergreen offers for this practice's newsletter. Hemisphere: ${hemisphere} (get the seasons right!).

PRACTICE: ${profile.businessDescription}
AUDIENCE: ${profile.who}
SPECIALIZATION: ${profile.primarySpecialization ?? profile.industry}

Rules: offers are practice-visit promotions (assessments, check-ups, seasonal programs, family bundles) — NEVER discounts framed as therapeutic guarantees, no outcome claims (AHPRA-safe). Titles ≤ 8 words, bodies 2-3 sentences, ctaLabel ≤ 4 words.
BENEFIT RULE (mandatory): every offer body ENDS with one concrete, tangible benefit the reader receives — a complimentary take-home resource (e.g. a printed posture guide, a personalized posture/movement report, a written home-exercise mini-plan, a workspace-setup checklist), never a price discount, percentage off, gift, or prize. The benefit must be something the practice can hand over at the visit, stated plainly ("…and take home your personalized posture report."). If a benefit has a condition, state it in the same sentence. No urgency or scarcity pressure ("only this week", "limited spots").
Return STRICT JSON: {"offers":[{"title":"...","body":"...","ctaLabel":"...","month":1},...,{"title":"evergreen one","body":"...","ctaLabel":"..."}]} — 12 with month + 2 without.`,
    'onboarding.offers',
    0.6,
  )
  return result.offers ?? []
}

/**
 * Logistics-only clinic FAQs for FAQPage schema markup (agent plan 3.1).
 * Hard rule: factual/practical questions only — never symptoms, conditions,
 * treatments, or outcomes.
 */
export async function generateClinicFaqs(
  apiKey: string,
  corpus: string,
): Promise<{ q: string; a: string }[]> {
  if (!corpus.trim()) return []
  const result = await geminiJson<{ faqs: { q: string; a: string }[] }>(
    apiKey,
    `From this clinic website text, produce 5-7 FAQ pairs for a FAQPage schema block.
STRICT RULES: logistics/practical ONLY — opening hours, location/parking, what to bring, appointment length, payment/insurance/health-fund basics, booking process, first-visit process. NEVER questions about symptoms, conditions, treatments, techniques, or outcomes. Answers 1-3 sentences, factual, drawn ONLY from the text (no inventions — omit a topic if the text doesn't cover it).
Return STRICT JSON: {"faqs":[{"q":"...","a":"..."}]}

WEBSITE TEXT:
${corpus.slice(0, 20_000)}`,
    'onboarding.clinic_faqs',
    0.2,
  )
  return (result.faqs ?? []).filter((f) => f.q?.trim() && f.a?.trim())
}

export async function generateCtaOptions(
  apiKey: string,
  profile: BrandProfileDraft,
): Promise<{ value: string; label: string }[]> {
  try {
    const result = await geminiJson<{ ctas: string[] }>(
      apiKey,
      `Write 3 alternative social-media call-to-action lines for this practice (each ≤ 12 words, concrete, no hashtags, no outcome claims):
PRACTICE: ${profile.businessDescription}
FIRST-VISIT PROCESS: ${profile.ourExperience}
Return STRICT JSON: {"ctas":["...","...","..."]}`,
      'onboarding.ctas',
      0.7,
    )
    return (result.ctas ?? []).map((c) => ({ value: c, label: c }))
  } catch (err) {
    logger.warn({ err }, '[onboarding] CTA generation failed — defaults apply')
    return []
  }
}

/**
 * Lightweight branded preview for "the reveal" — a self-contained HTML page
 * demonstrating the palette + logo as a newsletter would use them. The REAL
 * template fields are written on confirm; the full renderer keeps being the
 * production path. (Polish item: swap for a true renderNewsletterHtml sample.)
 */
export function buildTemplatePreviewHtml(opts: {
  organizationName: string
  logoUrl?: string | null
  palette: SemanticPalette
  /** Header logo/name layout — MUST mirror newsletter/render.ts headerBlock. */
  logoLayout?: 'replace' | 'beside' | 'above'
}): string {
  const p = opts.palette
  const header = p.headerBackground ?? '#0b2545'
  // Real sends render the header name white unless overridden — the preview
  // must promise exactly what render.ts delivers (preview-honesty rule).
  const headerText = p.headerText ?? '#ffffff'
  const accent = p.accent ?? '#2a6f97'
  const body = p.bodyBackground ?? '#ffffff'
  const tints = p.sectionTints?.length ? p.sectionTints : ['#f2f6fa', '#fdf6ee']
  const btn = p.button ?? accent
  const btnText = (p as { buttonText?: string }).buttonText ?? nlLabelColorFor(btn)
  const esc = (s: string) => s.replace(/</g, '&lt;')
  const layout = opts.logoLayout ?? 'replace'
  const nameH1 = `<h1 style="margin:0;font-size:22px;color:${headerText}">${esc(opts.organizationName)}</h1>`
  let headerInner: string
  if (!opts.logoUrl) {
    headerInner = nameH1
  } else if (layout === 'beside') {
    headerInner = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>
      <td style="vertical-align:middle;padding-right:14px"><img src="${opts.logoUrl}" alt="logo" style="max-height:48px;max-width:160px"/></td>
      <td style="vertical-align:middle;text-align:left">${nameH1}</td></tr></table>`
  } else if (layout === 'above') {
    headerInner = `<img src="${opts.logoUrl}" alt="logo" style="max-height:48px;max-width:60%"/><div style="height:8px"></div>${nameH1}`
  } else {
    headerInner = `<img src="${opts.logoUrl}" alt="logo" style="max-height:56px;max-width:70%"/>`
  }
  return `<!doctype html><html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:${body}">
<div style="max-width:600px;margin:0 auto">
  <div style="background:${header};color:${headerText};padding:28px 24px;text-align:center">
    ${headerInner}
    <p style="margin:8px 0 0;font-size:13px;opacity:.85">Your monthly health letter</p>
  </div>
  <div style="padding:20px 24px">
    <h2 style="color:${header};font-size:18px;margin:0 0 8px">This is your featured article headline</h2>
    <p style="font-size:14px;line-height:1.6;color:#333">A short teaser paragraph showing exactly how your newsletter body text will read. Links look <a style="color:${accent}" href="#">like this</a>.</p>
  </div>
  <div style="background:${tints[0]};padding:16px 24px">
    <h3 style="margin:0 0 6px;font-size:15px;color:${header}">Quick tips section</h3>
    <p style="margin:0;font-size:13px;color:#444">Alternating section bands use your site's tones.</p>
  </div>
  <div style="padding:16px 24px">
    <a href="#" style="display:inline-block;background:${btn};color:${btnText};padding:10px 18px;border-radius:6px;font-size:14px;text-decoration:none">Book an appointment</a>
  </div>
  <div style="background:${tints[1] ?? tints[0]};padding:16px 24px">
    <h3 style="margin:0 0 6px;font-size:15px;color:${header}">Seasonal offer</h3>
    <p style="margin:0;font-size:13px;color:#444">Your offers will appear in cards like this one.</p>
  </div>
  <div style="background:${header};color:${headerText};padding:18px 24px;text-align:center;font-size:12px;opacity:.9">
    ${esc(opts.organizationName)} · You're receiving this because you're a valued patient.
  </div>
</div></body></html>`
}
