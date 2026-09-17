# Social slides: story images, text modes, in-place editing (2026-09-17)

Decisions (Veit):
- **P2 gets a generated image** (Nano Banana / gemini-3.1-flash-image —
  same cheap model as diagram restyle, ~$0.04/image): visual variety that
  TELLS THE STORY of the slide's message. Slide text unchanged — but
  editable. **Azavea's own-content carousel design stays untouched**
  (client newsletter sets only).
- Contrast: **bias to white** — white text whenever its worst-case blend
  contrast clears AA (4.5); near-black only when white genuinely fails.
- **Per-post Light/Dark text toggle** overriding the automatic choice
  (flips text color + logo variant together, all slides in the post).
- **Slide-text editing included** — fix the words without re-rolling.

## 1. The recomposite primitive (everything rides on this)

All three features are one operation: re-run the deterministic
SVG→PNG compositor for a post's slides with overrides — no LLM.

- Storage: `overrides Json` on the social post/spec row that owns the
  generated carousel (exact table confirmed at build start — the row the
  newsletter social preview reads; likely the same one article social
  review uses). Shape:
  `{ textMode?: 'light'|'dark', slides?: { [i]: { headline?, body?, imageUrl? } } }`
- Endpoint: `POST /social/posts/:id/recompose { overrides }` — merges
  into stored overrides, re-runs the compositor for affected slides,
  replaces the registered media, returns fresh URLs. Regenerations of
  the post re-apply stored overrides (client edits survive re-rolls of
  OTHER parts, e.g. captions).
- Compositor: accepts forced tint scheme (`textMode`) — bypasses the
  auto pick; logo variant follows the text mode.

## 2. Contrast default: white bias (tiny, ships first)

`tintScheme` (brand-tint.ts): return white when
`minContrast(WHITE) >= AA_CONTRAST`, even if near-black scores higher;
dark only when white fails AA at the bumped alpha too. Existing tests
updated; new case: teal #3aa6b9 → white.

## 3. P2 story image (client newsletter carousels only)

- Generation: at newsletter-social build time, ONE Nano Banana image per
  edition for the P2 half-panel: prompt derived from the P2 slide's
  message ("editorial photograph illustrating <slide message> for a
  chiropractic patient audience; warm, professional, NO text, NO
  logos"), 1:1, cost-logged like RESTYLE_COST_USD.
- Composite: image fills P2's non-panel half (the half-panel layout was
  built for exactly this); panel + text unchanged.
- Failure fallback: current motif background (never blocks the set).
- Guard: ONLY the client newsletter carousel path — the Azavea
  own-content story-arc design (motif backgrounds, locked 2026-08-24)
  is explicitly excluded by account/design check.
- The generated image is also swappable later via overrides.slides[i].imageUrl
  (regenerate button in the editor UI = new Nano Banana call).

## 4. Review UI (NewsletterSocialPreview + SocialReviewModal)

Per post:
- **Aa Light/Dark toggle** → recompose with textMode.
- **Edit slides** drawer: per slide, headline + body textareas seeded
  from current text → Save → recompose (only changed slides).
- P2 extra: "New image" button → fresh Nano Banana generation.
- Busy states per slide; preview swaps to the fresh URLs on completion.

## Sequencing

2 (white bias) → 1 (overrides + endpoint + compositor forcing)
→ 4 (UI) → 3 (P2 image gen + guard) → suites → staging → prod →
live check on the just-approved edition's carousel.

## Out of scope

- Azavea own-content visuals (locked design).
- Per-slide text modes (per-post only, per Veit).
- Article carousel image changes (already image-backed); the toggle +
  text editing DO apply to article carousels via the same primitive.
