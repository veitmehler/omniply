/**
 * Chat-agent guardrails (.plans/chat-agent-v1.implementation-plan.md §3).
 *
 * Two deterministic fences around the model:
 *  - checkRedFlags() runs BEFORE the model on the visitor's text — emergency
 *    presentations get a hard-coded urgent-care reply and never reach the LLM.
 *  - checkReply() runs AFTER the model on the assistant's text — diagnosis,
 *    treatment advice, outcome promises, inducements, and clinician-identity
 *    claims are replaced with the safe fallback and flag the transcript.
 *
 * Pure module: no imports, no I/O — everything here is CI-tested exactly as
 * it runs in production (same posture as the quiz math blocks).
 */

// ---------------------------------------------------------------------------
// Red-flag interception (pre-model)
// ---------------------------------------------------------------------------

interface RedFlagRule {
  label: string
  re: RegExp
}

/**
 * Emergency-presentation lexicon (chiropractic clinical red flags: cardiac,
 * cauda equina, stroke/VBI, thunderclap headache, major trauma, infection,
 * self-harm). Phrasing variants matter more than precision here — a false
 * positive sends someone to urgent care unnecessarily; a false negative is
 * the failure mode we must not have.
 */
const RED_FLAGS: RedFlagRule[] = [
  { label: 'cardiac', re: /\bchest (?:pain|pressure|tightness|heaviness)\b/i },
  { label: 'cardiac', re: /\bpain (?:radiat\w+|shooting|going) (?:down|into) (?:my |the )?(?:left )?arm\b/i },
  { label: 'breathing', re: /\b(?:can'?t|cannot|trouble|difficulty|hard to|struggling to) breath\w*\b/i },
  { label: 'breathing', re: /\bshort(?:ness)? of breath\b/i },
  { label: 'cauda-equina', re: /\bsaddle (?:numbness|anesthesia|anaesthesia)\b/i },
  { label: 'cauda-equina', re: /\bnumb\w* (?:in|around|down) (?:my |the )?(?:groin|saddle|inner thighs|both legs)\b/i },
  { label: 'cauda-equina', re: /\bboth (?:of my )?legs (?:are |feel |going |went )?(?:numb|weak|tingling)\b/i },
  { label: 'cauda-equina', re: /\b(?:loss of|lost|losing|no) (?:bladder|bowel) control\b/i },
  { label: 'cauda-equina', re: /\bincontinen\w+\b/i },
  { label: 'cauda-equina', re: /\bcan'?t (?:pee|urinate|pass urine|control my bladder|control my bowels)\b/i },
  { label: 'trauma', re: /\b(?:car|auto|motorbike|motorcycle|bike) (?:accident|crash|wreck)\b/i },
  { label: 'trauma', re: /\b(?:hit by a car|was in an accident|been in a crash)\b/i },
  { label: 'trauma', re: /\bfell (?:off|from|down) (?:a |the )?(?:ladder|roof|stairs|horse|height)\b/i },
  { label: 'headache', re: /\bworst headache\b/i },
  { label: 'headache', re: /\bthunderclap\b/i },
  { label: 'headache', re: /\bsudden(?:ly)? (?:severe|intense|excruciating) headache\b/i },
  { label: 'stroke', re: /\bstroke\b/i },
  { label: 'stroke', re: /\bface (?:is )?droop\w*\b/i },
  { label: 'stroke', re: /\bslurr\w* (?:my )?(?:speech|words|speaking)\b/i },
  { label: 'stroke', re: /\bone side of (?:my |the )?(?:body|face) (?:is |feels |went )?(?:numb|weak|droop\w*)\b/i },
  { label: 'collapse', re: /\b(?:passed out|blacked out|fainted|keep fainting|losing consciousness)\b/i },
  { label: 'seizure', re: /\bseizure\b/i },
  { label: 'cancer-sign', re: /\bunexplained weight loss\b/i },
  { label: 'self-harm', re: /\bsuicid\w*\b/i },
  { label: 'self-harm', re: /\b(?:kill|hurt|harm) myself\b/i },
  { label: 'self-harm', re: /\bend (?:my|it all) (?:life|all)?\b/i },
  { label: 'self-harm', re: /\bdon'?t want to (?:live|be alive|go on)\b/i },
  { label: 'overdose', re: /\boverdos\w+\b/i },
]

/** Fever + stiff neck TOGETHER (meningitis pattern) — neither alone triggers. */
const FEVER_RE = /\bfever(?:ish)?\b|\bhigh temperature\b/i
const STIFF_NECK_RE = /\bstiff neck\b|\bneck (?:is |feels )?(?:really |very )?stiff\b/i

/** Returns the matched red-flag label, or null when the text is safe. */
export function checkRedFlags(text: string): string | null {
  for (const rule of RED_FLAGS) {
    if (rule.re.test(text)) return rule.label
  }
  if (FEVER_RE.test(text) && STIFF_NECK_RE.test(text)) return 'infection'
  return null
}

// ---------------------------------------------------------------------------
// Emergency numbers (ISO 3166-1 alpha-2 → primary emergency number)
// ---------------------------------------------------------------------------

const EMERGENCY_NUMBERS: Record<string, string> = {
  US: '911',
  CA: '911',
  MX: '911',
  DO: '911',
  AU: '000',
  NZ: '111',
  GB: '999',
  IE: '999',
  // 112 works across the EU + many others.
  DE: '112', FR: '112', ES: '112', IT: '112', NL: '112', BE: '112',
  AT: '112', PT: '112', DK: '112', SE: '112', NO: '112', FI: '112',
  PL: '112', CH: '112', IN: '112', ZA: '112', SG: '995',
}

export function emergencyNumberFor(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null
  return EMERGENCY_NUMBERS[countryCode.toUpperCase()] ?? null
}

// ---------------------------------------------------------------------------
// Visitor-language detection (multilingual replies, 2026-10-28)
// ---------------------------------------------------------------------------

export type AgentLang = 'en' | 'es' | 'de' | 'fr' | 'ru'

/**
 * Deterministic, conservative language detection for the hard-coded replies
 * (the model already mirrors the visitor's language on its own; this covers
 * the strings the model never writes). Cyrillic is decisive for Russian;
 * the Latin languages score on distinctive diacritics + common words, and
 * anything ambiguous falls back to English — a wrong "en" is always safe.
 */
const LATIN_MARKERS: Record<'es' | 'de' | 'fr', { chars: RegExp; words: string[] }> = {
  es: {
    chars: /[¿¡ñ]/,
    words: ['hola', 'gracias', 'cuanto', 'cuánto', 'cuesta', 'puedo', 'tengo', 'quiero', 'necesito', 'dolor', 'cita', 'reservar', 'usted', 'cómo', 'como', 'dónde', 'mañana', 'ayuda', 'sesión', 'sesion', 'precio', 'duermo', 'pecho', 'semana', 'hacer'],
  },
  de: {
    chars: /[äöüß]/,
    words: ['ich', 'und', 'nicht', 'eine', 'einen', 'haben', 'kann', 'bitte', 'danke', 'hallo', 'termin', 'kostet', 'gibt', 'mit', 'ist', 'das', 'wie', 'viel', 'schmerzen', 'buchen', 'morgen', 'habt', 'gegen', 'mir', 'schwanger'],
  },
  fr: {
    chars: /[çàâèêëîôû]/,
    words: ['bonjour', 'merci', 'je', 'vous', 'est-ce', 'combien', 'coute', 'coûte', 'rendez-vous', 'séance', 'seance', 'pour', 'avec', 'une', 'quel', 'quelle', 'demain', 'douleur', 'proposez', 'faites', 'suis', 'votre', 'réduction'],
  },
}

const EN_WORDS = ['the', 'and', 'you', 'your', 'for', 'how', 'much', 'what', 'can', 'is', 'have', 'want', 'book', 'please', 'hello', 'thanks', 'tomorrow', 'appointment', 'does', 'much', 'with', 'about']

export function detectVisitorLanguage(text: string): AgentLang {
  if (/[Ѐ-ӿ]/.test(text)) return 'ru'
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-zà-ÿœ¿¡ñß-]+/u)
      .filter(Boolean),
  )
  const wordScore = (words: string[]) => words.reduce((n, w) => n + (tokens.has(w) ? 1 : 0), 0)
  const en = wordScore(EN_WORDS)
  let best: AgentLang = 'en'
  let bestScore = 0
  for (const lang of ['es', 'de', 'fr'] as const) {
    const m = LATIN_MARKERS[lang]
    const score = wordScore(m.words) + (m.chars.test(text) ? 2 : 0)
    if (score > bestScore) {
      best = lang
      bestScore = score
    }
  }
  return bestScore >= 2 && bestScore > en ? best : 'en'
}

// ---------------------------------------------------------------------------
// Localized hard-coded replies (the model never writes these — they must
// carry the visitor's language themselves). No punctuation dashes anywhere.
// ---------------------------------------------------------------------------

const URGENT_REPLIES: Record<AgentLang, (emergency: string) => string> = {
  en: (e) =>
    `What you're describing needs proper medical attention now. Please call ${e} or get to urgent care right away. ` +
    `This isn't something to wait on or handle over chat. Once you've been looked after, we're here to help with your ongoing care.`,
  es: (e) =>
    `Lo que describes necesita atención médica ahora mismo. Por favor llama al ${e} o acude a urgencias de inmediato. ` +
    `Esto no es algo que deba esperar ni resolverse por chat. Cuando ya te hayan atendido, aquí estamos para acompañarte.`,
  de: (e) =>
    `Was du beschreibst, braucht jetzt sofort medizinische Hilfe. Bitte ruf ${e} an oder fahre direkt in die Notaufnahme. ` +
    `Das ist nichts, womit man wartet oder was man per Chat klärt. Sobald du versorgt bist, sind wir gern für dich da.`,
  fr: (e) =>
    `Ce que vous décrivez nécessite une prise en charge médicale immédiate. Appelez le ${e} ou rendez-vous aux urgences sans attendre. ` +
    `Ce n'est pas quelque chose à gérer par chat. Une fois pris en charge, nous serons là pour vous accompagner.`,
  ru: (e) =>
    `То, что вы описываете, требует немедленной медицинской помощи. Пожалуйста, позвоните ${e} или сразу обратитесь в неотложную помощь. ` +
    `С этим нельзя ждать, и это нельзя решать в чате. Когда вам окажут помощь, мы будем рады поддержать вас.`,
}

const SELF_HARM_REPLIES: Record<AgentLang, (emergency: string) => string> = {
  en: (e) =>
    `I'm really glad you reached out, and I want to make sure you talk to someone who can properly help right now. ` +
    `Please call ${e} or a crisis line straight away. You deserve real support, and it's available right now. ` +
    `This chat isn't the right place for this, but please don't wait to make that call.`,
  es: (e) =>
    `Me alegra mucho que lo hayas contado, y quiero que hables ahora mismo con alguien que pueda ayudarte de verdad. ` +
    `Por favor llama al ${e} o a una línea de crisis ahora mismo. Mereces apoyo real, y está disponible ahora. ` +
    `Este chat no es el lugar adecuado para esto, pero por favor no esperes para hacer esa llamada.`,
  de: (e) =>
    `Gut, dass du dich meldest, und ich möchte, dass du jetzt mit jemandem sprichst, der dir wirklich helfen kann. ` +
    `Bitte ruf sofort ${e} oder eine Krisen-Hotline an. Du verdienst echte Unterstützung, und es gibt sie genau jetzt. ` +
    `Dieser Chat ist dafür nicht der richtige Ort, aber bitte warte nicht mit diesem Anruf.`,
  fr: (e) =>
    `Je suis vraiment content que vous en parliez, et je veux que vous parliez maintenant à quelqu'un qui peut vraiment vous aider. ` +
    `Appelez le ${e} ou une ligne d'écoute de crise tout de suite. Vous méritez un vrai soutien, disponible dès maintenant. ` +
    `Ce chat n'est pas le bon endroit pour cela, mais n'attendez pas pour passer cet appel.`,
  ru: (e) =>
    `Я очень рад, что вы написали, и хочу, чтобы вы прямо сейчас поговорили с тем, кто действительно может помочь. ` +
    `Пожалуйста, немедленно позвоните ${e} или на линию кризисной помощи. Вы заслуживаете настоящей поддержки, и она доступна прямо сейчас. ` +
    `Этот чат не подходит для такого разговора, но, пожалуйста, не откладывайте этот звонок.`,
}

const LOCAL_EMERGENCY_FALLBACK: Record<AgentLang, string> = {
  en: 'your local emergency number',
  es: 'tu número local de emergencias',
  de: 'deine örtliche Notrufnummer',
  fr: "votre numéro d'urgence local",
  ru: 'ваш местный номер экстренной помощи',
}

/** The hard-coded urgent-care reply (self-harm gets its own wording). */
export function redFlagReply(label: string, countryCode: string | null | undefined, lang: AgentLang = 'en'): string {
  const num = emergencyNumberFor(countryCode)
  const emergency = num ?? LOCAL_EMERGENCY_FALLBACK[lang]
  return label === 'self-harm' ? SELF_HARM_REPLIES[lang](emergency) : URGENT_REPLIES[lang](emergency)
}

// ---------------------------------------------------------------------------
// Reply post-filter (post-model)
// ---------------------------------------------------------------------------

/**
 * Negated-safety phrasings are GOOD replies ("I can't diagnose…") — strip
 * them before scanning so the scan only sees affirmative violations.
 */
const NEGATION_STRIPS: RegExp[] = [
  /\b(?:I |we )?(?:can'?t|cannot|am not able to|are not able to|won'?t|will not|unable to) (?:diagnose|give a diagnosis|prescribe|promise|guarantee)[^.!?]*/gi,
  /\bno (?:diagnosis|guarantees?|promises?)\b[^.!?]*/gi,
  /\bwithout (?:a )?(?:diagnosis|examining|an exam)\b/gi,
  /\bnot (?:a|medical) (?:doctor|advice)\b[^.!?]*/gi,
  /\b(?:isn'?t|is not|rather than) (?:a )?(?:diagnosis|medical advice)\b/gi,
]

interface ReplyRule {
  reason: string
  re: RegExp
}

const FORBIDDEN_REPLY: ReplyRule[] = [
  { reason: 'diagnosis', re: /\bdiagnos\w+\b/i },
  { reason: 'diagnosis', re: /\byou (?:probably |likely |may |might |definitely |clearly |almost certainly )?have (?:a |an )?(?:herniat|bulg|pinched|slipped|sciatic|subluxat|scolio|arthrit|degenerat|fractur|stenos|tumou?r|infection|misalign)\w*/i },
  { reason: 'diagnosis', re: /\b(?:it )?sounds like (?:you (?:have|might have|may have)|a herniat|a pinched|sciatica|a slipped)\b/i },
  { reason: 'treatment-advice', re: /\b(?:you should|I(?:'d| would)? recommend|try) (?:tak(?:e|ing)|stop(?:ping)? tak(?:e|ing)|start(?:ing)? tak(?:e|ing))\b/i },
  { reason: 'treatment-advice', re: /\b\d+\s?(?:mg|milligrams?|tablets?|pills?)\b/i },
  { reason: 'treatment-advice', re: /\b(?:ibuprofen|advil|tylenol|paracetamol|aspirin|naproxen|voltaren|codeine)\b/i },
  { reason: 'outcome-promise', re: /\bguarantee[ds]?\b/i },
  { reason: 'outcome-promise', re: /\bwill (?:cure|fix|heal|eliminate|get rid of)\b/i },
  { reason: 'outcome-promise', re: /\bcure[sd]?\b/i },
  { reason: 'outcome-promise', re: /\b100\s?% (?:success|effective|guaranteed|pain[- ]free)\b/i },
  { reason: 'outcome-promise', re: /\bpromise[sd]? (?:that )?(?:you|your pain|results|relief)\b/i },
  { reason: 'inducement', re: /\bdiscount\b/i },
  { reason: 'inducement', re: /\b\d+\s?% off\b/i },
  { reason: 'inducement', re: /\bfree (?:adjustment|treatment|consultation|session)\b/i },
  { reason: 'inducement', re: /\bspecial (?:offer|deal|promotion)\b/i },
  { reason: 'identity-claim', re: /\bI(?:'m| am) (?:a |your |the )?(?:doctor|chiropractor|physician|clinician|nurse|dr\.)\b/i },
  { reason: 'identity-claim', re: /\b(?:speaking )?as (?:a|your) (?:doctor|chiropractor|physician|clinician)\b/i },
  { reason: 'superlative', re: /\b(?:the )?best (?:chiropractor|chiro|clinic|practice) in\b/i },
]

export type ReplyVerdict = { ok: true } | { ok: false; reason: string }

/** Scan an assistant reply for forbidden patterns (negations stripped first). */
export function checkReply(reply: string): ReplyVerdict {
  let scanned = reply
  for (const strip of NEGATION_STRIPS) scanned = scanned.replace(strip, ' ')
  for (const rule of FORBIDDEN_REPLY) {
    if (rule.re.test(scanned)) return { ok: false, reason: rule.reason }
  }
  return { ok: true }
}

const FALLBACK_REPLIES: Record<AgentLang, (practiceName: string, phone: string | null | undefined) => string> = {
  en: (name, phone) =>
    `That's one the team at ${name} should answer for you properly. ` +
    `The best next step is to book a visit${phone ? ` or give the front desk a call on ${phone}` : ''}. They'll take good care of you.`,
  es: (name, phone) =>
    `Esa pregunta la debe responder bien el equipo de ${name}. ` +
    `El mejor siguiente paso es reservar una visita${phone ? ` o llamar a recepción al ${phone}` : ''}. Te van a atender muy bien.`,
  de: (name, phone) =>
    `Diese Frage beantwortet dir das Team von ${name} am besten direkt. ` +
    `Der beste nächste Schritt ist, einen Besuch zu buchen${phone ? ` oder die Rezeption unter ${phone} anzurufen` : ''}. Dort bist du in guten Händen.`,
  fr: (name, phone) =>
    `C'est une question à laquelle l'équipe de ${name} doit répondre correctement. ` +
    `La meilleure étape suivante est de réserver une visite${phone ? ` ou d'appeler l'accueil au ${phone}` : ''}. Ils prendront bien soin de vous.`,
  ru: (name, phone) =>
    `На этот вопрос вам лучше всего ответит команда ${name}. ` +
    `Лучший следующий шаг: записаться на визит${phone ? ` или позвонить на ресепшн по номеру ${phone}` : ''}. Там о вас позаботятся.`,
}

/** What the visitor sees when the post-filter rejects the model's reply. */
export function safeFallbackReply(practiceName: string, phone: string | null | undefined, lang: AgentLang = 'en'): string {
  return FALLBACK_REPLIES[lang](practiceName, phone)
}

// ---------------------------------------------------------------------------
// Input limits (engine constants, kept here so tests cover them)
// ---------------------------------------------------------------------------

export const MAX_MESSAGE_CHARS = 600
export const MAX_VISITOR_TURNS = 30

// ---------------------------------------------------------------------------
// Punctuation-dash elimination (chat output backstop)
// ---------------------------------------------------------------------------

/**
 * Replace punctuation dashes (em/en dashes, spaced hyphens) with plain
 * grammar. Word-internal hyphens (X-ray, well-being) are untouched. The
 * prompt rule catches ~95%; this guarantees the rest.
 */
export function stripPunctuationDashes(text: string): string {
  return (
    text
      // Numeric/time RANGES first (Veit 2026-09-19): "2–6 PM" must never
      // become "2, 6 PM" (live chat mangled the opening hours). A dash
      // between digits — en, em, or bare hyphen — reads as "to", which is
      // also the more natural conversational rendering. Times like "1:30"
      // and trailing meridiems ride along untouched. BOTH sides must be
      // 1-2 digit numbers (C3 round 2, 2026-10-07): hours and ranges never
      // exceed two digits, while "765-333-4455" was being mangled into
      // "765 to 333 to 4455" — phone numbers keep their hyphens. The
      // lookbehind keeps date-ish chains ("2026-10-08") intact too.
      .replace(/(?<![\d—–-])(\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)\s*[—–-]\s*(?=\d{1,2}(?!\d))/g, '$1 to ')
      .replace(/\s*[—–]\s*/g, ', ') // remaining em/en dashes, any spacing
      .replace(/\s+-\s+/g, ', ') // spaced hyphen used as punctuation
      .replace(/,\s*,/g, ', ') // collapse accidental double commas
      .replace(/([.!?:])\s*,\s*/g, '$1 ') // comma right after terminal punctuation
      .replace(/\s{2,}/g, ' ')
  )
}
