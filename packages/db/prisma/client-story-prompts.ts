/**
 * Client-story review-mining prompt templates (`cs_*`).
 *
 * DB-backed PromptTemplate rows looked up by string `key` (not `stepNumber`),
 * same convention as the newsletter `nl_*` prompts (see newsletter-prompts.ts) —
 * `stepNumber` only exists because the column is required+unique; this range
 * (400+) avoids colliding with enrichment's 100s, social's 200s, and
 * newsletter's 300+. See
 * .plans/client-story-review-mining.implementation-plan.md Phase 4.
 *
 * Imported by prisma/seed.ts (prod auto-seeds) and scripts/seed-client-story-
 * prompts.ts (staging, which does not run the seed step).
 */
import type { NewsletterPromptTemplate } from './newsletter-prompts'

const GEMINI_FLASH_LITE = 'gemini-3.1-flash-lite'

export const CLIENT_STORY_TEMPLATES: NewsletterPromptTemplate[] = [
  {
    stepNumber: 400,
    key: 'cs_story_triage',
    stepName: 'client_story_triage',
    defaultProvider: 'gemini',
    defaultModel: GEMINI_FLASH_LITE,
    maxTokens: 512,
    systemPrompt:
      'You review a single Google review for a local business and decide whether it describes a ' +
      'specific client experience (a real story: a problem, what was done, an outcome) versus ' +
      'generic praise ("great service, 5 stars", "friendly staff"). If it is a real story, you ' +
      'rewrite it as a short, de-identified case example suitable for a marketing article — this ' +
      'is a strict requirement, not a style preference: NEVER include the reviewer\'s name or any ' +
      'identifying detail, NEVER mention star ratings or that this came from a review, NEVER ' +
      'write "a reviewer said" or similar attribution framing. Write it as a clean narrative case ' +
      'example a business could reference directly. Soften outcome language — describe ' +
      'improvement, not cures or guarantees; avoid absolute claims.',
    userPrompt: `REVIEW TEXT:
{{reviewText}}

INDUSTRY: {{industry}}

Decide: is this a specific client story (problem → what was done → outcome), or generic praise?

If it is generic praise, or too vague to form a real narrative, return:
{"isStory": false}

If it is a real story, return:
{"isStory": true, "storyText": "a 2-4 sentence de-identified narrative case example — no names, no stars, no review framing, softened outcome language", "topicTags": ["2-4 short keyword tags describing what the story is about, e.g. lower back pain, pediatric, sports injury"]}

Output STRICT JSON only (no markdown, no commentary).`,
    isActive: true,
  },
  {
    stepNumber: 401,
    key: 'cs_beat_extract',
    stepName: 'story_beat_extract',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 4096,
    systemPrompt:
      'You read what a practice owner said during onboarding (spoken, transcribed, unedited) and you ' +
      'extract every real story in it: a specific client, a specific moment in the practice, a mistake, ' +
      'a lesson, a result they saw. You then rewrite each story as a short beat the owner could publish ' +
      'tomorrow in an article or a social post, in their own first-person voice.\n\n' +
      'SANITIZING IS NOT OPTIONAL. Every beat you return must already be safe to publish:\n' +
      '- No names of clients, staff, doctors, dentists or other third parties. Exact ages become a ' +
      'decade ("a woman in her sixties"). Identifying places, dates and employers go. Nationality, sport, ' +
      'profession and family role may stay when they carry the story.\n' +
      '- Cause and cure become what was observed and what was done, in the owner\'s voice. "The true cause ' +
      'was poison" becomes "her scan pointed to mercury, and the fillings were one possible source". ' +
      '"The supplement stopped the bleeding" becomes "she told me the bleeding had stopped within days". ' +
      'Keep the owner\'s own hedges ("I believe it was", "within a couple of months").\n' +
      '- Substances in a regulatory grey zone are NEVER named: peptides, hormones, unapproved or ' +
      'prescription compounds become "a supervised protocol" or "a targeted supplement protocol". ' +
      'Common foods, sleep, movement and named clinic services (massage, hyperbaric oxygen, PEMF, ' +
      'adjustments) may be named.\n' +
      '- No diagnoses stated as fact about a named person, no promises, no "cured", "healed", "reversed", ' +
      '"fixed", "guarantee". Results are reported, not claimed.\n' +
      '- Keep what makes the story specific and human: the situation, what the owner noticed, what they ' +
      'did, what the person reported afterwards.\n\n' +
      'Each beat is 2 to 4 sentences. Skip anything that is not a story (opinions, service lists, ' +
      'philosophy). If a story cannot be made publishable at all, leave it out.',
    userPrompt: `OWNER: {{ownerName}} ({{industry}}; {{businessName}})

TRANSCRIPTS (each block is one onboarding answer; "step" names the question):
{{transcripts}}

Return STRICT JSON only:
{"beats": [
  {"step": "which transcript block it came from",
   "originalExcerpt": "the owner's own words for this story, copied verbatim (up to 400 characters)",
   "kind": "client_case" | "owner_moment",
   "text": "the publishable 2-4 sentence beat, first person, sanitized as instructed",
   "topicTags": ["2-4 short keywords describing what the story is about"]}
]}
Return {"beats": []} if there are no stories.`,
    isActive: true,
  },
]
