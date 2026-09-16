# Logo color variant — end the silhouette-only pipeline (2026-09-16)

## Root cause (found during run-4 logo investigation)

`newsletter/logo-process.ts` BY DESIGN recolors every logo into exactly two
monochrome silhouettes (white "light", navy "dark") and discards the real
brand colors. No surface downstream of the logo picker ever shows the
client's actual logo — the thread behind every logo complaint across runs
2–4 (invisible white-on-white header, "my logo never appears").

User decisions (2026-09-16):
- Newsletter: client CHOOSES original / light / dark — original is default.
- Social post + diagram overlays: ALWAYS silhouette (light or dark by
  background) — "only there for branding; a full color logo in that place
  would be too much color information."
- NO onboarding reset — current run (session cmu4cj4xu, parked at
  logo_confirm) continues once this deploys; the logo step then generates
  all three variants and template reveal shows the new selector.

## 1. logo-process.ts: true-color cutout

- ProcessedLogo gains `colorUrl` + `colorLuminance` (avg WCAG luminance of
  opaque pixels — the contrast guard's input).
- Same pipeline (mask → crop → upload), one new output that applies the
  alpha WITHOUT the recolor step. For sources with native transparency this
  is the original, tidied.

## 2. Storage

- Migration (the only one): `brand_settings.nlLogoColorUrl TEXT`.
- toRenderBrand += nlLogoColorUrl (dmmf completeness test enforces this
  automatically — do NOT put it on the EXCLUDED list).
- commitLogoConfirm: stepData.logoVariants = {lightUrl, darkUrl, colorUrl,
  colorLuminance}; persist nlLogoColorUrl; organizationLogoUrl becomes
  color ?? dark ?? light (the public-profile logo should be the real one).

## 3. Template reveal card (embed cards.tsx TemplateCard)

- Logo picker becomes 3-way: **Original (default)** / Light / Dark.
- Contrast guard: compare variant vs chosen headerBackground luminance
  (colorLuminance for original; ~1.0 for light; ~0.05 for dark). Low
  contrast → auto-suggest the visible variant + small warning chip. The
  run-2 white-on-white invisibility becomes impossible to ship silently.
- Answer carries logoVariant: 'color' | 'light' | 'dark'.

## 4. commitTemplateReveal

- Honor 'color' → nlLogoUrl = colorUrl (layout logic unchanged).

## 5. Settings parity

- TemplateEditorView logo-variant picker gains Original, same guard, both
  embed and main app (thin-wrapper pages share the component).

## 6. Consumer policy audit

- **Social slides + diagram watermarks: NO CHANGE** — brand-theme.ts and
  enrichment watermarking keep silhouette-by-background (user decision).
  Verify nothing accidentally starts reading nlLogoColorUrl here.
- **Quiz (spine-check/generate.ts)**: header band logo picks by headerBg
  luminance — color logo when contrast allows, else light silhouette.
- **Linktree (lib/linktree.ts)**: same rule as quiz.
- **Newsletter**: whatever the client picked (flows through nlLogoUrl —
  no render change needed).

## 7. Tests

- logo-process: color cutout preserves hues (distinct-color count vs
  source; silhouettes stay monochrome), colorLuminance sanity.
- commitTemplateReveal mapping for logoVariant 'color'.
- Render completeness test covers nlLogoColorUrl by construction.

## 8. Rollout (NO reset)

Implement → both suites → staging → prod (in-flight gate; the parked
onboarding session lives in the DB and survives the API blip — tell Veit
to continue only AFTER the deploy confirmation). Veit resumes at
logo_confirm: picks the logo → three variants generated → template reveal
shows the Original/Light/Dark selector with the contrast guard.
