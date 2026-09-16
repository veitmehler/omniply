# Newsletter review UX — check, edit, sign off (2026-09-16)

Selling point (Veit): the client CHECKS the edition, EDITS anything that's
wrong, toggles OFF what they don't want, and SIGNS OFF. Approval freezes
exactly what they saw (Option B already live). Three features, one page:
`NewsletterEditionContent.tsx` (the ready_for_review view).

## 1. Per-section content editing (run-5 item 2)

Today only subject + preview text are editable; the PATCH endpoint already
accepts wholesale section JSON (featureArticle, secondaryArticle, teasers,
quickHits, fun, modules) — no UI on it.

- Each rendered section in the review page gets an **Edit** affordance:
  - feature/secondary: contentEditable editor seeded with the body HTML
    (bold/italic/lists via execCommand-level controls, nothing fancier).
  - teasers: per-teaser textarea (headline + body + CTA).
  - quickHits: editable line lists (tips, facts).
  - fun: three plain inputs (joke, trivia Q, trivia A).
  - modules (recipes): intro/ingredients/instructions textareas.
- Save → existing PATCH `/newsletters/:id` with the section JSON → Option B
  re-render → preview updates in place.
- **Server-side sanitize on PATCH** (security): allowlist p, h2, h3, ul,
  ol, li, strong, em, b, i, a[href http(s)], br; strip everything else
  (style/script/on*). The render normalizer handles styling anyway.
- Editable only in `ready_for_review` (matches existing subject guard).

## 2. Per-section on/off toggles (run-5 item 3)

Two levels, one shape:
- `BrandSettings.nlSectionsDisabled Json` — template-level defaults
  ("never include the joke"), editable in Settings → Newsletter design as
  a checkbox group.
- `Newsletter.sectionsDisabled Json` — per-edition override in the review
  page (checkbox strip above the preview; union of both = hidden).
- Render: one filter before assembly skips disabled keys.
- Section keys: video, joke, trivia, tips, didYouKnow, recipe, recipe2,
  teaser1..3, secondaryArticle, seasonalOffer, evergreenOffer. The feature
  article is not toggleable (it IS the newsletter).
- ONE migration (both Json columns).

## 3. Video controls (run-5 item 4)

The override slot (`topic.videoUrl`) and oEmbed enrichment already exist.
- Review page video card gains:
  - **Find another** → POST `/newsletters/:id/video/next`: re-runs the
    YouTube search excluding already-seen URLs (track
    `research.video.rejectedUrls[]`), updates research + re-render.
  - **Use my link** → POST `/newsletters/:id/video` `{url}`: validate
    YouTube/Vimeo URL, oEmbed title/thumbnail, thumbnail→S3, set
    `topic.videoUrl` + research.video, re-render.
  - **Remove video** → per-edition toggle from feature 2.

## Sequencing

2 (migration + render filter + Settings checkboxes + review strip)
→ 3 (endpoints + card controls)
→ 1 (section editors, feature/secondary first, then the rest)
→ suites → staging → prod → Veit walkthrough on the live sample.

1 is the largest; 2+3 are each small. All three ride the existing PATCH /
Option B machinery — no render-architecture changes.

## Out of scope

- Rich-text beyond bold/italic/lists; image editing inside bodies.
- Editing after approval (frozen by design — regenerate path exists).
- A "refresh research" admin affordance (noted separately, ops-only).
