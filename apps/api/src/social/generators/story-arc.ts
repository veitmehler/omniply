import { prisma, brandSettingsForUser } from '@omniply/shared'
import { loadSocialBrandTheme, commentHookFromTheme } from '../brand-theme'
import { verticalForUser } from '../../lib/prompt-resolver'
import { getLLMAdapter } from '../../article-pipeline/llm/factory'
import { loadPromptTemplate } from '../../article-pipeline/enrichment/prompt-template'
import { loadPlainLanguageConfig } from '../../article-pipeline/enrichment/plain-language'
import { sanitizeDashesText } from '../../lib/text/dash-sanitizer'
import { recordLLMUsage } from '../../lib/llm-usage'
import { logger } from '../../lib/logger'
import type { AutomationLogContext } from '../automation/log-context'
import type { ArticleContentContext } from '../automation/content'

/**
 * Story-arc generator (engagement v2 — .plans/story-arc-posts plan).
 *
 * ONE LLM call produces ALL beats of an article's story arc: generating
 * siblings together makes continuity and mutual distinctness structural
 * (the same principle as batched captions). Each beat is a first-person
 * story post in the account NARRATOR's voice plus its Instagram slide
 * breakdown (hook line alone, cliffhanger-cut middle beats, open-loop
 * close).
 *
 * Compliance frame ("superficial arcs", user-locked 2026-09-03): the
 * narrator observes industry patterns and their own professional journey.
 * Composite, explicitly generic scenes are allowed. NEVER identifiable
 * patients, never invented patient events presented as real, never
 * outcome promises.
 */

export interface StoryBeat {
  /** LinkedIn-ready post text (also the FB text and the IG caption). */
  postText: string
  /** IG carousel: slide 1 = hook line alone; middle 20–35 words each. */
  slides: string[]
}

const SYSTEM_PROMPT =
  'You are a ghostwriter for a business owner, writing serialized first-person LinkedIn story posts. ' +
  'The voice must read like a real person: short lines, concrete scenes, an admission of doubt before any insight, ' +
  'no hype, no hashtags, no emoji. Never use em-dashes; use commas, colons, or separate sentences. ' +
  'TRUTH RULE (the most important rule): events that happened TO THE NARRATOR may come ONLY from the ' +
  'provided narrator moments, retold faithfully. You may NEVER invent a personal experience, test, audit, ' +
  'count, conversation, or discovery, even a plausible one. Article material must be narrated as ' +
  'OBSERVATION about the industry or practices ("I keep seeing...", "Picture a practice owner who...", ' +
  '"you open the guidance and realize..."), never as something the narrator personally did or found. ' +
  'A post with zero personal scenes is fine; a post with a fabricated one is a failure. ' +
  'The narrator is a software builder, not a clinician: patients, patient files, clinics, or board letters may never appear as the narrator\'s own — and neither may invented business interactions: discovery calls, client consultations, or access to any practice\'s dashboards, phone logs, or data. Default voice is first-person OBSERVER: "I" as a commentary lens on the industry, never invented events. ' +
  'COMPLIANCE (hard rules): never mention or invent identifiable patients or specific patient events; ' +
  'composite scenes must be explicitly generic ("every practice has a Tuesday like this"); ' +
  'never promise business or health outcomes; numbers come only from the article material provided. ' +
  'When mentioning court cases or legal decisions: describe them ONLY as examples of what actually happened in that specific case; NEVER assert a case as \"precedent\" or claim it establishes a legal rule for a different context unless the source material explicitly states that holding applies. ' +
  'Output ONLY a JSON array, no code fences, no commentary.'

function buildUserPrompt(opts: {
  beatCount: number
  narratorName: string
  narratorBeats: string
  writingStyle: string
  restrictions: string
  articleTitle: string
  articleMaterial: string
  articleUrl: string
  ctaLine: string
  priorPosts: string[]
}): string {
  const prior = opts.priorPosts.length
    ? opts.priorPosts.map((p, i) => `--- Prior post ${i + 1} (most recent first) ---\n${p}`).join('\n\n')
    : '(none yet)'
  return `Write a ${opts.beatCount}-post story arc based on this article. The posts publish in order (morning/evening slots on consecutive posting days) and together tell ONE story with rising tension.

NARRATOR: ${opts.narratorName}, the practice/business owner, first person.
REAL narrator moments you may draw on (never invent new biographical facts beyond these and the article):
${opts.narratorBeats || '(none provided: stay with industry observations and the article material only)'}

WRITING VOICE:
${opts.writingStyle || 'Plainspoken, concrete, operator-to-operator.'}

ADVERTISING RESTRICTIONS (hard rules; may be empty):
${opts.restrictions}

ARTICLE TITLE: ${opts.articleTitle}
ARTICLE MATERIAL (the arc's substance; numbers may ONLY come from here):
${opts.articleMaterial}

RECENTLY PUBLISHED STORY POSTS (for callbacks and to avoid repeating scenes):
${prior}

ARC RULES:
- Beat 1 opens on a concrete scene or surprising observation, never a summary.
- VOICE: first-person observer throughout. The narrator comments as "I" even on article material ("I keep seeing...", "I read the FTC notices so you do not have to", "Here is what jumped out at me").
- The article's own scenes, metaphors, and story boxes are your PRIMARY narrative material: RETELL them as scenes the narrator PRESENTS about a practice owner ("Picture the owner who...", "The scene from the article stuck with me: ..."). Prefer retelling an article scene over abstract observation.
- HARD RULE: an article scene may NEVER become the narrator's own experience. The narrator is a software builder: no patients, no patient files, no clinic, no board letters or investigations addressed to them. ALSO BANNED as invented events: discovery calls, client consultations, conversations with practice owners, or looking at any practice's dashboards, phone logs, calendars, or data ("a practice owner books a call with me" is a FABRICATION unless it appears in a narrator moment). First person is a commentary lens, never invented events.
- Beats 2 and onward OPEN with one short re-anchoring line that orients a first-time reader (half a sentence referencing where the story stands) before continuing.
- Every beat except the last ends mid-tension with an open loop to the next.
- SCHEDULE: beats alternate morning and evening, starting with a morning beat. A MORNING beat's open loop points at TONIGHT ("Tonight: ..."); an EVENING beat's open loop (except the last beat, which resolves) points at TOMORROW ("Tomorrow morning: ..."). Never use the wrong label, and NEVER write clock times in the copy (no "at 19:00", no "at 7 PM"): "Tonight" and "Tomorrow morning" are the only schedule words.
- The LAST beat resolves the arc and its POST TEXT (never a slide) may include exactly one soft mention of the article${opts.articleUrl ? ` (link: ${opts.articleUrl})` : ''}.
- EVENING beats (beat 2${opts.beatCount >= 4 ? ' and beat 4' : ''}): the POST TEXT ends with exactly this call-to-action line as its final line: "${opts.ctaLine}"${opts.ctaLine ? '' : ' (no CTA line provided: end naturally)'}
- Beats never reuse a scene, opening, or anecdote from each other or from the prior posts above.
- Narrator moments are FACTS: never merge two different moments into one scene, and never attach a date or timeframe to a moment unless it appears in that moment's own text.
- NEVER invent events, experiments, tests, products, conversations, or timelines that are not explicitly described in a narrator moment or the article. If a moment lacks detail, stay abstract rather than inventing specifics.
- Every number in every post must appear VERBATIM in the article material or a narrator moment. No derived, estimated, or invented figures.
- Write every figure as numerals exactly as printed in the source (15.6%, $5,000, 30-40%); NEVER spell numbers out in words, even in spoken-style lines.
- 120 to 220 words per post. Short lines. Separate THOUGHTS with a BLANK line (a thought may span several sentences); never run two thoughts together in one paragraph.

For EACH beat also produce its Instagram slide breakdown:
- slides[0] = the hook line ALONE (one punchy sentence, max 12 words).
- middle slides = 40 to 60 words each (3 to 4 short sentences), each CUT at a moment of tension so the swipe is the payoff.
- When a beat presents an enumerated sequence (pillars, steps, reasons), give each item its OWN slide whose text starts with its number and a period ("1. ...", "2. ..."). NEVER label items "Step 1", "Pillar 2", "Phase 3" or similar: the "N. " prefix is the ONLY numbering. Never number slides that are not list items.
- Any slide that lists TWO OR MORE actions, tasks, or checks MUST put each on its own line starting with "- " (hyphen space, one action per line, no "Step N" labels), unless the beat's primary numbered sequence already gives each item its own slide. NEVER present a list of actions as consecutive sentences in a paragraph. A beat's PRIMARY enumerated sequence always uses the one-item-per-slide "N. " form above, never bullets.
- last slide = the open loop (or, for the final beat, the resolution) plus a short follow cue. The open loop must point FORWARD IN TIME at the next post ("Tomorrow: ..." / "Part 2 tonight."), NEVER at further swiping: the word "swipe" is FORBIDDEN on the last slide (there is nothing after it).
- NEVER put the call-to-action line in any slide: it is appended as its own dedicated final slide automatically.
- Slides must NEVER direct the reader to the article or any external destination: no web addresses (https:// or bare domains like example.com/page), no "link in bio", no "pinned comment", no "first comment", no "full breakdown at...", no "read the article". On slides the article may appear only as a SOURCE ("The article cited..."), never as a destination. Links and the article mention belong in the post text only.
- 4 to 6 slides per beat.

EVENING beats additionally output "ctaBridge": ONE short PIVOT line (max 12 words) written in your own words, a question or turn toward getting help that picks up THAT beat's specific subject (its scene, task, or pain) and offers relief from it. Each evening bridge must be DIFFERENT from the others. It must contain NO digits, NO durations, NO statistics, NO URL, and must not name or describe the offer itself (the call-to-action is appended automatically after it and carries its own number). Morning beats omit the field.

Return ONLY a JSON array of ${opts.beatCount} objects: [{"postText": "...", "slides": ["...", ...], "ctaBridge": "..."}, ...]
CRITICAL JSON RULE: inside string values, NEVER use straight double quotes. Quote words with typographic quotes (“like this”) or single quotes instead — a straight " inside a value breaks the JSON.`
}

function extractJsonArray(raw: string): unknown[] | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  const body = cleaned.slice(start, end + 1)
  try {
    const parsed = JSON.parse(body)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    // Dominant real-world failure (found 2026-09-07 via the raw-output log):
    // the model quotes phrases with raw double quotes INSIDE string values
    // ('a PDF titled "Ultimate Guide"...') — invalid JSON. Repair pass:
    // walk the text; a quote inside a string is STRUCTURAL only when
    // followed (after whitespace) by , } ] or :, otherwise escape it.
    try {
      let out = ''
      let inString = false
      for (let i = 0; i < body.length; i++) {
        const ch = body[i]
        if (ch === '\\' && inString) { out += ch + (body[i + 1] ?? ''); i++; continue }
        if (ch !== '"') { out += ch; continue }
        if (!inString) { inString = true; out += ch; continue }
        const rest = body.slice(i + 1).match(/^\s*([,}\]:])/)
        if (rest) { inString = false; out += ch } else { out += '\\"' }
      }
      const parsed = JSON.parse(out)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

/** Build the article material block from the run's content context. */
export function articleMaterialFromCtx(ctx: ArticleContentContext): string {
  // FULL article (user decision 2026-09-03): the plain-language layer bakes
  // composite scenes/metaphors/story boxes into the sections — feeding them
  // whole gives the writer truthful, pre-vetted narrative material instead
  // of a fact digest that forces invention or abstraction.
  const sections = ctx.h2Sections
    .slice(0, 10)
    .map((s) => `## ${s.heading}\n${s.text.slice(0, 2500)}`)
    .join('\n\n')
  return [ctx.introText?.slice(0, 2000), ctx.keyTakeawaysText?.slice(0, 1500), sections]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 24000)
}

export async function generateStoryArc(opts: {
  userId: string
  articleTitle: string
  articleMaterial: string
  articleUrl: string
  beatCount: number
  logCtx: AutomationLogContext
}): Promise<StoryBeat[]> {
  const { userId, beatCount, logCtx } = opts

  const [brand, theme, t] = await Promise.all([
    brandSettingsForUser(userId),
    loadSocialBrandTheme(userId),
    loadPromptTemplate(230, { userId }),
  ])

  let restrictions = ''
  try {
    const pl = await loadPlainLanguageConfig(theme.industry)
    if (pl) restrictions = pl.restrictions
  } catch {
    /* proceed without */
  }

  // Callback pool: the narrator's most recent published/scheduled story posts.
  const prior = await prisma.post.findMany({
    where: { userId, postType: 'story_text', platform: 'linkedin', status: { in: ['scheduled', 'published'] } },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: { content: true },
  })

  const userPrompt = buildUserPrompt({
    beatCount,
    narratorName: brand?.storyNarratorName ?? brand?.defaultAuthorName ?? 'the owner',
    narratorBeats: brand?.storyBeats ?? '',
    writingStyle: theme.writingStyle || '',
    restrictions,
    articleTitle: opts.articleTitle,
    articleMaterial: opts.articleMaterial,
    articleUrl: opts.articleUrl,
    ctaLine: theme.socialCallToAction?.trim() || '',
    priorPosts: prior.map((p) => p.content),
  })

  const provider = (t?.defaultProvider ?? 'anthropic').toLowerCase()
  const model = t?.defaultModel ?? 'claude-sonnet-4-5-20250929'
  const adapter = getLLMAdapter(provider)
  const run = await adapter.call({
    systemPrompt: t?.systemPrompt ?? SYSTEM_PROMPT,
    userPrompt,
    model,
    temperature: 0.7,
    maxTokens: 2000 * beatCount,
  })
  await recordLLMUsage(userId, 'story_arc', run)

  let parsed = extractJsonArray(run.content)
  if (!parsed || parsed.length < beatCount) {
    // One retry — truncated/malformed JSON is the dominant failure mode.
    // Log head+tail of the raw output: the Lead Magnets article failed 4x
    // with zero diagnostics (sweep 2026-09-07). Retry gets more headroom.
    logger.warn(
      { ...logCtx, rawLen: run.content.length, rawHead: run.content.slice(0, 300), rawTail: run.content.slice(-300) },
      '[story-arc] unparseable output — retrying once',
    )
    const retry = await adapter.call({
      systemPrompt: t?.systemPrompt ?? SYSTEM_PROMPT,
      userPrompt,
      model,
      temperature: 0.6,
      maxTokens: 2500 * beatCount,
    })
    await recordLLMUsage(userId, 'story_arc', retry)
    parsed = extractJsonArray(retry.content)
  }
  if (!parsed || parsed.length < beatCount) {
    throw new Error(`Story arc: expected ${beatCount} beats, got ${parsed?.length ?? 'unparseable'}`)
  }

  // Deterministic no-URL guarantee for slides (bare domains slipped past the
  // prompt rule — user 2026-09-04): drop any sentence containing a web address.
  const URL_RX = /https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|io|net|org|ai|co|app|dev|us)\b(?:\/\S*)?/i
  // Destination pointers are banned as a semantic CLASS, not a phrasing: each
  // ban of one surface form (URL → bare domain → "linked in the first
  // comment") just mutated the expression (user 2026-09-04). Slides may cite
  // the article as a source, never point at it as a destination.
  const POINTER_RX =
    /link in bio|pinned comment|first comment|in the comments|comments? below|full breakdown|read the (?:full )?article|find the (?:full )?article|linked in the/i
  const stripUrlSentences = (s: string) =>
    s
      .split('\n')
      .map((line) =>
        line
          .split(/(?<=[.!?])\s+/)
          .filter((seg) => !URL_RX.test(seg) && !POINTER_RX.test(seg))
          .join(' '),
      )
      .filter((l) => l.trim().length > 0)
      .join('\n')
      .trim()
  // "Step 3: ..." → "3. ..." so the numeral slide design triggers: the label
  // form slipped between the numbered-slide and bullet rules (user
  // 2026-09-04). Bullet lines drop the redundant label entirely.
  const normalizeListMarkers = (s: string) =>
    s
      .replace(/^(?:Step|Pillar|Phase|Part|Rule|Task)\s+(\d{1,2})\s*[:.]\s*/i, '$1. ')
      .replace(/^-\s+(?:Step|Pillar|Phase|Part|Rule|Task)\s+\d{1,2}\s*[:.]\s*/gim, '- ')
  // Conservative auto-bulletizer: a task list flattened into prose (an intro
  // ending ":" followed by imperative-start sentences, or 3+ imperative
  // starts without one) is rewritten onto "- " lines; non-imperative
  // follow-up sentences attach to the preceding bullet (user 2026-09-04: the
  // audit checklist rendered as a paragraph). Heuristic by design —
  // unrecognized prose passes through untouched.
  const IMPERATIVE_RX =
    /^(search|review|check|open|scan|flag|ask|count|compare|list|audit|remove|delete|rewrite|verify|read|look|find|test|measure|track|update|replace)\b/i
  const bulletizeProseTasks = (s: string) => {
    if (/^-\s/m.test(s) || /^\d{1,2}\.\s/.test(s.trim())) return s
    return s
      .split('\n')
      .map((line) => {
        const m = line.match(/^([^:]{0,80}:)\s+(.+)$/)
        const body = m ? m[2] : line
        const sentences = body.split(/(?<=[.!?]["')]?)\s+/)
        const imperatives = sentences.filter((x) => IMPERATIVE_RX.test(x.trim())).length
        if (sentences.length < 2 || imperatives < (m ? 2 : 3)) return line
        const out: string[] = []
        for (const raw of sentences) {
          const t = raw.trim()
          if (IMPERATIVE_RX.test(t)) out.push(`- ${t.charAt(0).toUpperCase()}${t.slice(1)}`)
          else if (out.length > 0 && out[out.length - 1].startsWith('- ')) out[out.length - 1] += ` ${t}`
          else out.push(t)
        }
        return (m ? [m[1], ...out] : out).join('\n')
      })
      .join('\n')
  }
  // Morning beats (even index) tease the SAME-DAY evening post; evening beats
  // tease tomorrow morning. The model cannot know the slot map, so enforce the
  // open-loop label deterministically (user 2026-09-04: "Tomorrow" on a 7:00
  // post whose sequel lands at 19:00).
  const fixLoopLabel = (txt: string, idx: number) => {
    if (idx === beatCount - 1) return txt
    return idx % 2 === 0 ? txt.replace(/\bTomorrow:/g, 'Tonight:') : txt.replace(/\bTonight:/g, 'Tomorrow:')
  }

  const beats: StoryBeat[] = []
  const ctaBridges: (string | null)[] = []
  for (const raw of parsed.slice(0, beatCount)) {
    const b = raw as { postText?: unknown; slides?: unknown; ctaBridge?: unknown }
    const postText = typeof b.postText === 'string' ? b.postText.trim() : ''
    const slides = Array.isArray(b.slides)
      ? b.slides.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
      : []
    if (!postText || slides.length < 3) throw new Error('Story arc: beat missing postText or slides')
    const stripDashes = (txt: string) => txt.replace(/\s*[—–]\s*/g, ', ')
    // Guarantee a blank line after every thought in the post text: upgrade any
    // single line break to a paragraph break (user 2026-09-04). Slides keep
    // their own spacing (renderer concern).
    const blankLineThoughts = (txt: string) =>
      txt.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/([^\n])\n(?!\n)/g, '$1\n\n')
    if (/swipe/i.test(slides[slides.length - 1] ?? '')) {
      logger.warn({ ...logCtx, beat: beats.length + 1 }, '[story-arc] final slide invites swiping despite rule — review will catch')
    }
    const beatIdx = beats.length
    // One content-aware pivot line bridging the beat into the appended CTA
    // slide (user 2026-09-04: the bare hook after content read disconnected).
    // The hook line owns the only number on that slide, so a bridge carrying
    // any digit or duration is rejected outright (user 2026-09-04: "15 min"
    // bridge collided with the hook's "2-minute") — the fallback pivots cover
    // rejection, so the slide never regresses to the bare hook.
    const bridgeRaw = typeof b.ctaBridge === 'string' ? b.ctaBridge.split('\n')[0].trim() : ''
    const bridgeUnsafe =
      !bridgeRaw ||
      bridgeRaw.length > 120 ||
      URL_RX.test(bridgeRaw) ||
      /\d/.test(bridgeRaw) ||
      /\b(minute|min|hour|second|day|week|month|year)s?\b/i.test(bridgeRaw) ||
      /let someone else run the audit|landing on your desk/i.test(bridgeRaw) ||
      ctaBridges.includes(stripDashes(bridgeRaw))
    if (bridgeUnsafe && beatIdx % 2 === 1) {
      logger.warn({ ...logCtx, beat: beatIdx, bridgeRaw: bridgeRaw.slice(0, 160) }, '[story-arc] ctaBridge rejected — using fallback pivot')
    }
    ctaBridges.push(bridgeUnsafe ? null : stripDashes(bridgeRaw))
    beats.push({
      postText: fixLoopLabel(
        blankLineThoughts(stripDashes((await sanitizeDashesText(postText, { ...logCtx, surface: 'story_post' })).trim())),
        beatIdx,
      ),
      slides: (
        await Promise.all(
          slides.map(async (s) =>
            fixLoopLabel(
              stripUrlSentences(bulletizeProseTasks(normalizeListMarkers(stripDashes((await sanitizeDashesText(s, { ...logCtx, surface: 'story_slide' })).trim())))),
              beatIdx,
            ),
          ),
        )
      ).filter((s) => s.length > 0),
    })
  }

  // Evening beats get a DEDICATED CTA slide (deterministic layout). The
  // SLIDE carries the comment-keyword hook, not a URL: slide text is not
  // clickable on Instagram, and comments feed the keyword funnel + capture
  // the lead (user decision 2026-09-03). Clinics get a parameterized
  // keyword in P3; azavea uses XRAY.
  const ctaLine = theme.socialCallToAction?.trim() || ''
  // Evening post text must end with the CTA line — the prompt asks for it,
  // but the model occasionally closes on the open loop instead (Aug-31 beat
  // shipped with no lead-gen CTA at all — sweep 2026-09-07). Enforce it.
  if (ctaLine) {
    for (let i = 1; i < beats.length; i += 2) {
      if (!beats[i].postText.includes(ctaLine)) {
        beats[i].postText = beats[i].postText.trimEnd() + '\n\n' + ctaLine
      }
    }
  }
  const vertical = await verticalForUser(userId).catch(() => null)
  const commentHook =
    vertical === 'azavea'
      ? 'Comment "XRAY" and I will send you the free 2-minute Practice X-Ray.'
      : (commentHookFromTheme(theme) ?? ctaLine)
  // Pre-approved pivots when the generated bridge was rejected: fixed,
  // compliance-vetted, number-free — the CTA slide always keeps a bridge.
  const BRIDGE_FALLBACKS = [
    'Want this handled for you instead?',
    'There is a faster way to see the same thing.',
    'You do not have to find this alone.',
  ]
  if (commentHook) {
    for (let i = 1; i < beats.length; i += 2) {
      const bridge = ctaBridges[i] ?? BRIDGE_FALLBACKS[Math.floor(i / 2) % BRIDGE_FALLBACKS.length]
      beats[i].slides.push(`${bridge}\n${commentHook}`)
    }
  }

  logger.info({ ...logCtx, beats: beats.length }, '[story-arc] arc generated')
  return beats
}
