# Run-3 Findings Batch — 8 fixes from the final-product E2E (2026-09-16)

Sources: Veit's Settings audit + reveal-vs-render comparison + logo question +
writing-sample UX + phone-only booking question. All web/API code, NO
migrations except item 8's one nullable column. Nothing touches the demo
account's current state; item 1 immediately corrects the newsletter design
Veit sees in Settings.

## 1. toRenderBrand: button fields + the completeness test (BUG, first)

`newsletter/generate.ts toRenderBrand` — the single shared mapping — has ZERO
references to `nlButtonColor`/`nlButtonTextColor`: every render (Settings
preview AND generated editions) silently drops the approved teal button +
white label, falling back to nlLinkColor + computed text. This is why the
design "isn't what I approved" persisted after the endpoint consolidation.
- Add both fields to the mapping.
- NEW TEST (the drift-class killer): introspect Prisma's BrandSettings field
  list, assert every `nl*` column appears in toRenderBrand's output when set
  on a fixture — any future nl* column that isn't mapped fails CI.

## 2. Structured address from the GHL prefill (kills the "re-enter" prompt)

Settings' Business address section uses STRUCTURED fields (addressLine1,
addressLocality, addressRegion, postalCode) and shows a migration prompt when
only the legacy combined string exists — which is exactly what onboarding
writes. Irony: bootstrap RECEIVES the components separately (loc.address,
city, state, postalCode) and joins them.
- bootstrap: carry the components into ghlPrefill (addressLine1, city, state,
  postal alongside the joined string).
- commitBusinessConfirm: persist the structured fields + keep
  organizationAddress/geolocation combined for legacy consumers.
- Demo backfill: parse the demo's stored string into the four fields.

## 3. Explicit primary specialization on the profile card (Veit: "too important")

Both runs auto-picked prenatal_pediatric; the client never chose.
- ProfileCard: among CHECKED specialization chips, a primary marker
  (radio/star), preset to the detected one; copy: "Your primary
  specialization drives your monthly content calendar."
- Answer carries `primarySpecialization`; commitBrandProfile honors it (must
  be one of the checked keys) instead of detected-if-checked-else-first.

## 4. Logo extraction: srcset-aware + WP size-suffix stripping

The header <img>'s src is WordPress's 120x120 THUMBNAIL; the original
(SimonChiroCenter-Logo.png) only appears in `srcset` at the largest width.
site-analysis.ts logo collection (~line 181) reads src only.
- Parse srcset on logo-ish <img> tags; prefer the largest-width URL.
- Also derive the original by stripping the WP `-\d+x\d+` suffix before the
  extension; push both (dedup keeps order: original first).
- Benefits every WordPress clinic (custom-logo always has this markup).

## 5. Writing-sample step: way back + demoted Skip

- "Paste my article instead" currently hides the button set with no return:
  add "← Back — I'll use the article you found" above the textarea
  (pasteOpen=false).
- Skip STAYS (ghostwritten-blog clinics with nothing to paste need it) but
  demoted from peer button to a small text link with consequence copy:
  "Skip — my written style will be built from my spoken answers only."

## 6. Diagram palette inherits the extracted site palette

diagram* fields are never set at onboarding → diagrams are default-styled
(accent/logos leak in via nl fallbacks only). At commitTemplateReveal, map
the approved palette into the diagram fields (diagramPrimaryColor ← header,
diagramTextColor ← dark ink, diagram logo variants ← processed logos — exact
field mapping confirmed against the diagram consumers during build).
Demo backfill included.

## 7. Font polish (minor)

- Crawl fontHints: resolve WordPress preset vars — extract 'cardo' from
  `var(--wp--preset--font-family--cardo)` → 'Cardo' (title-cased slug).
- Reveal-card preview + server preview builder: use the DETECTED font
  (fontHints[0]) instead of hardcoded Arial — the same font real sends use
  (preview-honesty rule).

## 8. Phone-only booking mode

booking_url currently HARD-REQUIRES a URL — a phone-only clinic is stuck.
- Step UI: URL input + explicit "We take bookings by phone" button (a valid
  business model, not a skip).
- Storage: BrandSettings.bookingMode String? ('online'|'phone') — the ONE
  migration in this batch; phone mode requires organizationPhone present.
- Call-first fallback audit: linktree promotes "Call Us" to the top CTA when
  no bookingUrl; quiz closing CTA becomes tel: "Call to book"; caption CTA
  uses the phone phrasing (same one the quiz-consent decline path uses);
  generation-readiness accepts phone mode instead of demanding a URL.
- Settings: booking section allows adding a URL later (upgrades everything).

## Sequencing

1 (+test) → 2 → 4 → 5 → 7 (small, related surfaces) → 3 → 8 (each has a
commit-level test pass) → 6 → full suites → staging → prod → demo backfills
(2, 6) → Veit visual verification in the embed (newsletter design in
Settings now matches the reveal; address prompt gone).

## Explicitly out / parked

- LinkedIn personal auto-fill: working as designed (no personal profile
  connected in GHL — nothing to fetch). Activates when one is connected.
- Article typography auto-set from site fonts (bigger design question).
- Model choice: settled (Sonnet 4.5, ~92-93% voiced, ~4min/library).
