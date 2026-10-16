import type { AuthorityType } from './authority-rotation'

/**
 * Authority register shapes (.plans/authority-content-engine plan, v2 —
 * ARC-INTEGRATED per Veit 2026-10-15: registers are woven INTO the existing
 * story-arc posts and the syndication platform articles; there is NO
 * standalone authority post. The v1 standalone generator/cron were removed
 * the same day they shipped, before their first run.)
 */
export const REGISTER_SHAPES: Record<AuthorityType, string> = {
  opinion:
    'OPINIONATED register. Shape: stake one clear claim early → name the common bad advice it replaces → ' +
    'what that advice actually costs (money, patients, time; numbers only from the material) → what to do instead. ' +
    'No hedging words (no "maybe", "perhaps", "in my opinion"). The claim must be defensible from the material.',
  belief_shift:
    'BELIEF-SHIFTING register. Shape: open on the assumption most readers hold → acknowledge why it once made sense → ' +
    'the break: the evidence or change that invalidated it (from the material) → the new mental model, stated crisply, ' +
    'ideally with a short memorable name.',
  leadership:
    'THOUGHT-LEADERSHIP register. Shape: a concrete observation or pattern (from the material) → the lens that explains ' +
    'it → a prediction or operating principle. First person. Allowed to be early; never vague. ' +
    'One prediction maximum, and it must follow from the stated evidence.',
  proof:
    'PROOF-LED register. Shape: the before-state with context → what was done → the real number or verifiable fact ' +
    '(VERBATIM from the material; if the material has no usable number, use its strongest verifiable fact) → the ' +
    'generalizable lesson. Never round, derive, or estimate figures.',
  framework:
    'FRAMEWORK-DRIVEN register. Shape: name the model (short, memorable) → its 3 to 5 parts → when it applies → one ' +
    'concrete application from the material. The parts must come from the material, not be invented.',
}

/** Dominant-register directive for a LONG-FORM platform article (syndication). */
export function articleRegisterDirective(type: AuthorityType): string {
  return (
    `DOMINANT REGISTER FOR THIS ARTICLE: ${type}.\n` +
    `${REGISTER_SHAPES[type]}\n` +
    'Apply this register to the ARTICLE as a whole: it sets the lead, the hook, and the thesis. ' +
    'Other registers may appear as supporting ingredients inside sections, but the opening and the through-line ' +
    'belong to this register alone. All substance still comes from the source article; never manufacture claims, ' +
    'numbers, or events to serve the register.'
  )
}

/** Dominant-register directive for a STORY ARC (the serialized beat posts). */
export function arcRegisterDirective(
  type: AuthorityType,
  opts?: {
    /** Healthcare compliance preamble (clinic accounts). */
    chiro?: boolean
    /** Clinic authority-pool material for this register (synthesized from the
     *  owner's onboarding interview) — same truth rules as narrator moments. */
    material?: string[] | null
  },
): string {
  const parts = [
    `DOMINANT REGISTER FOR THIS ARC: ${type}.`,
    REGISTER_SHAPES[type],
    "Weave this register into the ARC as its through-line: beat 1's hook and the final beat's resolution carry it " +
      'strongest; middle beats advance the serialized story while reinforcing it. The arc rules below (open loops, ' +
      're-anchoring, schedule labels, slide formats) and EVERY truth/compliance rule override register pressure: when ' +
      'the register wants a claim the material cannot support, drop the claim, never the rule.',
  ]
  // Opinion tightening (2026-10-16: azavea opinion arcs drifted into
  // framework-style enumeration instead of defending one claim).
  if (type === 'opinion') {
    parts.push(
      "For the opinion register specifically: beat 1's FIRST LINE stakes the claim itself (not a scene, not a " +
        'question), and every beat advances or defends that ONE claim. Do not drift into enumerating a model or ' +
        'framework; the claim is the spine.',
    )
  }
  if (opts?.chiro) {
    parts.push(
      'COMPLIANCE SCOPE (healthcare practice — hard rule): opinions, claims, and stances live in practice ' +
        'MARKETING, patient experience, operations, and care philosophy ONLY. Never clinical claims, treatment ' +
        'outcomes, condition promises, or anything resembling medical advice. Patient proof may only be the ' +
        "provided de-identified material or the practice's own aggregate numbers (review counts, ratings).",
    )
  }
  if (opts?.material?.length) {
    // Clinic pools often hold ONE long transcript per register — give single
    // items full room, trim harder only when a pool has many entries.
    const perItem = opts.material.length <= 2 ? 1200 : 400
    const items = opts.material.slice(0, 8).map((m) => `- ${m.slice(0, perItem)}`)
    parts.push(
      `REGISTER MATERIAL for ${type} (the owner's own words from their interview — you may draw on these under the ` +
        'same truth rules as narrator moments: retold faithfully, never embellished, never merged):\n' + items.join('\n'),
    )
  }
  return parts.join('\n')
}
