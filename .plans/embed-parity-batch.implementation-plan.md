# Embed Parity Batch — Ideas Bank, automated final quality check, Newsletter settings

Veit decisions 2026-09-15 (mid-E2E-2 review of the client shell). Pre-launch.
After this batch: onboarding RESET #3 → full recheck of the complete product.

## A. Ideas: capture panel (My Content) + Ideas Bank tab

Existing machinery (all reusable):
- `(protected)/ideas/page.tsx` — the full Ideas Bank: list via `/api/topics/ideas`,
  edit via TopicEditModal (mode, framework, special instructions, real case
  studies), CSV import/export. Plain fetch → embed bridge compatible.
- `features/idea-capture/` — the capture feature (used on /workflow).
- API: `routes/topics.ts` (status 'idea' rows; idea → dated topic = enters plan).

Build:
1. Extract the Ideas page body into `features/ideas/IdeasBankView.tsx`
   (embedMode prop hides CSV import/export if it misbehaves in-iframe; keep
   if it works — test download via blob in iframe).
2. EmbedShell gains an **Ideas** tab (order: My Content · Ideas · Lead
   Magnets · Settings) mounting IdeasBankView.
3. My Content gains a slim **capture panel** (one input + Add) posting the
   same `/api/topics` idea-create the capture feature uses; link "Flesh out
   in Ideas →" switches tabs.
4. Use-in-plan: the Bank's existing edit modal already dates a topic (dated
   idea → 'pending' → enters the window). Surface that as the "Use in this
   month's plan" affordance + REPLACE-by-default semantics: when dating an
   idea into the current window, offer to swap it against a not-yet-generated
   calendar topic on the same slot (keeps monthly volume/cost predictable);
   "add as extra" = secondary option. (New small endpoint if the swap isn't
   expressible with existing PATCHes.)

## B. Automated final quality check (replaces the manual Gemini copy-paste)

Current state: SECOND check = human pastes the finished article into external
Gemini (workflow FinalReviewPanel links gemini.google.com + copy button);
remedy = POST `/articles/:jobId/rewrite` (re-runs steps 7–12, status gate
'completed'). FIRST check (Phase-1 auto gate) already writes
`ArticleJob.qualityVerdict` `{verdict,severity,reasons[],geminiSummary}` and
ContentPlan already renders a "Flagged by quality check" inbox from it.

Build (mirror Phase-1 semantics, Veit-approved shape):
1. New pipeline step `final_quality_check` at the END of enrichment (before
   the job is presented ready): LLM evaluation against Google
   helpful-content/E-E-A-T guidelines. Prompt seeded from the copy-button
   payload's evaluation framing (reuse its rubric verbatim where present).
   Provider: gemini for now (cost); prompt row via seed (new stepName, so
   the deploy-time seed CREATES it — no manual prod push needed).
2. Verdict → `ArticleJob.finalQualityVerdict Json?` (new column, migration)
   — kept separate from the Phase-1 gate verdict so both are visible.
3. On hard fail: AUTO-REWRITE ONCE — invoke the existing steps-7–12 rerun
   (`triggerRewrite` internals of /articles/:jobId/rewrite, refactored into a
   shared function) → re-run the check → store both attempts (attempt count
   in the verdict JSON). CAP = 1 automatic rewrite; still-failing articles
   surface honestly.
4. Review surface (ContentPlan review flow): green "Passed quality checks"
   badge, or the fail panel with reasons + manual "Rewrite article" button
   (same endpoint, now reachable from the embed). Approve stays possible but
   visually de-emphasized on fail.
5. The manual copy-paste block in FinalReviewPanel stays for now (main-app
   users may like the ritual) but gains the automated verdict display too.

## C. Newsletter design + offers → Settings

Existing: `(protected)/newsletter/template` (editor over TEMPLATE_FIELDS
PATCH — now includes the four new header/button fields) and
`(protected)/newsletter/offers` (NewsletterOffer CRUD + banner-image route,
already dual-auth swept).

Build:
1. Extract both page bodies into `features/newsletter/TemplateEditorView.tsx`
   + `features/newsletter/OffersView.tsx` (mechanical: they're client pages
   on relative fetches).
2. SettingsView gains two sections (both shells see them): **Newsletter
   design** (mount TemplateEditorView — live preview now honest thanks to
   the toRenderBrand fix) and **Seasonal offers** (OffersView).
3. Original /newsletter/template and /newsletter/offers pages become thin
   wrappers of the same views (zero-drift pattern).

## D. NOT in scope

- Content calendar month view — DROPPED (grid view already serves, Veit).
- Model switch for guide rewrites — awaiting round-5 Gemini pass-rate data.
- Settings kill-switches for WP installs (post-launch backlog §5).

## Order of work + verification

1. B first (migration + pipeline step + seed row) — API-side, deploy alone.
2. A + C (web-heavy) — no migration; single web deploy.
3. Full suites green; staging → verify in GHL iframe (Ideas CRUD, settings
   sections render, review badge) → prod.
4. RESET #3 (reset-onboarding.ts) → Veit's full recheck: onboarding →
   consents → burst → quality badge on the sample article → guide approval
   (post-guard-fix voiced PDFs) → SPINE/DM/chat/voice legs → filming.

## Open items folded from the running session

- Round-5 guide recompile + Gemini pass-rate measurement (fires after the
  current promotion chain) — decides rewrite model.
- Oxylabs env fix verification on next newsletter research run.
- q_proof etc. all healthy this run; no data restores pending.
