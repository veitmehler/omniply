# Article Consistency Audit (step 20.5) — Implementation Plan

Status: PLANNED 2026-10-16. Not yet built — awaiting go.
Origin: the 2026-10-15/16 manual quality sweep of six backfill articles found
14 issues across two structural classes that BOTH existing gates (pre-approval
quality gate + post-enrichment final quality check) are blind to by design:

- **Class A — summary/body math divergence**: a derived headline number that
  does not follow from the article's own stated inputs ($54,000 vs the $27,000
  its math supports; intro "$150 CAC" vs the body's cited "$350–700").
- **Class B — derivative-surface invention**: an enrichment generator doing
  its own arithmetic ($22,000 invented by the GEO-summary call (step 19),
  then inherited verbatim by the Mermaid diagram (step 21), which consumes
  the post-GEO HTML — enrichment/index.ts:340).
- Plus recurring secondaries: mis-applied legal instruments (False Claims
  Act cited for advertising; "HIPAA advertising guidelines"), stat-verb drift
  (Oldroyd's 21× "qualify" → "convert"), uncited precise benchmarks ("three
  referrals over two years", "conservative" labels on aggressive assumptions).

Decisions locked with Veit (2026-10-16 discussion):
1. **Dedicated step, not an extension** of the editorial gates — different
   persona (forensic auditor vs "would Google rank this"), different remedy
   (surgical patch vs full rewrite), different inputs. Kitchen-sink prompts
   dilute both tasks.
2. **Position: step 20.5** — inside the enrichment handler, AFTER GEO
   summaries (19) + Key Takeaways/TOC (20) exist, BEFORE diagrams (21).
   Every text surface anything derives from is final; nothing visual is
   rendered yet, so fixes cost zero re-renders and diagrams inherit
   corrected text.
3. **Client-facing, never admin-facing**: at 100 clients nobody can edit
   articles for clients. Auto-fix what guards allow; what guards reject
   becomes a plain-language suggestion card in the CLIENT review surface
   (Phase 2). Nothing routes to the admin needs_review path.
4. **No diagram auditing**: diagrams get correct inputs (position) plus a
   verbatim-numbers rule (below) removing their license to compute.
5. **No cross-article canonical numbers** — out of scope until a niche
   needs it (Veit 2026-10-16).

## Architecture

```
enrichment: …19 GEO → 20 KT+TOC → [20.5 CONSISTENCY AUDIT] → 21 diagrams → …
                                     │
          ┌──────────────────────────┴───────────────────────────┐
          │ 1. figure extractor (deterministic, regex)           │
          │ 2. audit LLM call (step-111 template, structured ops)│
          │ 3. guard chain per op (uniqueness / bounded diff /   │
          │    arithmetic eval / scope rules)                    │
          │ 4. apply passed ops to title/excerpt/intro/KT/body   │
          │ 5. store rejected ops → sitePage.auditFindingsJson   │
          └──────────────────────────────────────────────────────┘
```

Never blocks: audit-call failure, timeout, or unparseable output → log,
record zero ops, enrichment continues unchanged. The article shipping with a
known class of defect is the status quo; the audit only ever improves on it.

## Phase 1 — the engine (build first; azavea + all client verticals)

### 1. New module `apps/api/src/article-pipeline/enrichment/consistency-audit.ts`

**Entry point** (called from index.ts between the KT try-block and
`setEnrichmentPhaseStep(jobId, 21)`):

```ts
runConsistencyAudit(opts: {
  jobId: string
  userId: string
  title: string          // sitePage.seoTitle ?? title
  excerpt: string | null
  introHtml: string      // the pre-first-H2 slice (variable `intro`)
  keyTakeawaysHtml: string | null
  bodyHtml: string       // `bodyWithIds` — post-GEO, post-PL, heading-ids injected
}): Promise<{
  title: string; excerpt: string | null; introHtml: string
  keyTakeawaysHtml: string | null; bodyHtml: string
  applied: AuditOp[]; rejected: AuditOp[]
  cost: number; inputTokens: number; outputTokens: number
}>
```

Wrapped in `withTimeout(…, 4 * 60_000, 'consistency-audit')` and a
try/catch that returns the inputs untouched on any throw. Env kill-switch
`CONSISTENCY_AUDIT_ENABLED=0`.

### 2. Deterministic figure extractor

Regex pass over each surface (tags stripped, same helper family as
quality-gate's text prep): `$[\d,.]+[KkMm]?`, `\d+(\.\d+)?%`, `\d+x|\d+ times`,
spelled ranges (`\d+ to \d+`). Output: a labeled table
`surface → [figures in order, each with ±80 chars of context]`. This table is
PREPENDED to the audit prompt so the model reconciles a structured inventory
instead of hunting through prose — the main reliability lever.

### 3. The audit call

- PromptTemplate **step 111** (`@@unique(stepNumber, vertical)`; seeded in
  `packages/db/prisma/` alongside the other quality prompts; code carries the
  inline default like story-arc/geo do, so an unseeded DB still works).
- Default `anthropic` / current Sonnet (swap to 5.5 in the migration window —
  the audit doubles as the migration's measuring stick). DB row makes
  provider/model swappable without deploys. Measured cost estimate:
  ~35–45k input tokens → **$0.12–0.15/article** (Flash-tier fallback ≈$0.02
  if cost ever matters).
- Persona: forensic auditor. Checks, in priority order:
  1. every derived figure recomputes from its stated inputs; every summary
     surface (title/excerpt/KT/geo-summary blocks) agrees with body math;
  2. named laws/agencies/cases map to their actual instrument
     (OCR→PHI disclosures, FTC→advertising, state boards→licensure,
     FCA→government billing, guidance≠mandate);
  3. quoted statistics keep the source's verb and scope (qualify ≠ convert);
  4. precise uncited benchmarks → soften ("up to", drop "conservative").
- Output: ONLY JSON — `{ ops: AuditOp[] }`, max **10** ops:

```ts
interface AuditOp {
  surface: 'title' | 'excerpt' | 'intro' | 'keyTakeaways' | 'body'
  find: string          // verbatim, unique in the surface, incl. any inline tags
  replace: string
  reason: string        // one sentence, client-readable
  math?: string         // REQUIRED when `replace` changes a number:
                        // a bare arithmetic expression, e.g. "3*4*2250*12"
}
```

The model never returns the document and never gets a "rewrite section" op.
Same JSON-repair fallback as story-arc/authority parsing.

### 4. Guard chain (deterministic, in code — reject keeps the original)

1. **Uniqueness**: `find` occurs exactly once in its surface. Zero or >1 → reject.
2. **Scope**: `find` must not contain `<h1-h6`, `<figure`, `href=`, or cross a
   block boundary (reuse BLOCK_BOUNDARY from the dash sanitizer). Headings,
   links, and structure are out of bounds.
3. **Bounded diff**: token-level compare (wordTokens) — at most 12 token
   insertions+deletions, no new URLs/domains, no new named entities longer
   than 3 tokens, no em/en dashes introduced. Philosophy proven by the dash
   sanitizer's `rewriteIsSafe` since July: a rejected fix beats meaning drift.
4. **Arithmetic eval**: when the numeric content of `replace` differs from
   `find`, `math` is required; a safe evaluator (digits + `+-*/().,` only,
   no identifiers) computes it and the result (±rounding to the displayed
   precision) must appear in `replace`. No expression / mismatch → reject.
5. **Op cap**: >10 ops in the response → keep the first 10, log.

Passed ops apply via literal `String.split(find).join(replace)` per surface.
Rejected ops are kept (see 6).

### 5. Wiring in `enrichment/index.ts`

After the KT/TOC try-block: call `runConsistencyAudit` with
`{title: sitePage.seoTitle ?? sitePage.title, excerpt: sitePage.excerpt,
introHtml: intro, keyTakeawaysHtml, bodyHtml: bodyWithIds}`; replace the five
locals with the returned versions; if title/excerpt changed, update sitePage
immediately. Accumulate cost/tokens into the run totals (shows in job costs
as source `consistency_audit` via recordLLMUsage). Diagrams then derive from
the patched `bodyWithIds` with no further changes.

### 6. Findings persistence

- Migration: `site_pages.auditFindingsJson Json?` —
  `{ auditedAt, applied: AuditOp[], rejected: AuditOp[] }` (applied kept for
  the audit trail; rejected are Phase 2's card source).
- Log line per article: counts + reasons (sweepable like dash-sanitizer logs).

### 7. Verbatim-numbers rules (prevention, same commit)

One-sentence addition to the inline DEF_SYS of:
- `geo-summary-generator.ts` (step 104) — the proven origin of Class B;
- `key-takeaways-generator.ts` (step 107);
- `mermaid-generator.ts` —
"Numbers may ONLY be copied verbatim from the provided text. NEVER compute,
sum, derive, or estimate a figure — if the text states a total, use that
total; if it states none, present items without one."
⚠️ DB prompt rows for 104/107 (both envs) override the inline defaults —
check `prompt_templates` and append the rule to any seeded row too.

### 8. Tests (vitest, no network)

- figure extractor: formats ($1.2M, 14.8%, "21 times", "30 to 45").
- each guard: uniqueness miss, heading-scope reject, 13-token drift reject,
  URL-introduction reject, arithmetic mismatch reject, rounding tolerance.
- applyOps: multi-surface apply + idempotence.
- **Regression fixtures replaying this week's real cases**: the $54k body
  (expects a $27,000 op with math "3*4*2250*4"… actual: "2250*4*3"), the
  $22k geo-summary vs $39k body, $150-vs-$653 intro, FCA sentence (expects
  a reject-or-reframe op), "21 times more likely to convert".
  (Fixture = the audit PROMPT I/O contract tested with a stubbed adapter;
  live-LLM spot run happens in rollout, not CI.)

## Phase 2 — client suggestion cards (separate build, after Phase 1 soaks)

- Rejected ops surface in the CLIENT article review page (the existing
  review/edit-request UI, live since 2026-09-16) as plain-language cards:
  reason + before/after text + **one-click Apply** that calls the existing
  content PATCH endpoint with the op's find/replace (re-running guards 1–3
  server-side at click time). Dismiss stores the decision.
- Ready-for-review email gains one line when cards exist ("2 suggestions to
  review"). No admin involvement anywhere.
- Until Phase 2 ships, rejected ops are visible in auditFindingsJson/logs
  only — articles are never blocked on them.

## Rollout

1. Build + tests green → deploy on idle queue (standard discipline).
2. Live validation: re-run enrichment is NOT needed — instead run the audit
   module one-off (dist require, like the retrofit scripts) against 3 already
   -enriched backfill articles in dry-run mode (ops computed, not applied)
   and eyeball precision/recall against the known findings.
3. Watch the next 5 cadence articles' audit logs; tune the prompt if ops are
   noisy (>3 ops/article sustained = too chatty; 0 ops on a planted error =
   recall gap).
4. When Sonnet 5.5 lands (window closes Oct 28): flip step-111's defaultModel
   first, compare findings-per-article before/after as the migration metric.

## Cost & limits

+$0.12–0.15/article (one Sonnet-tier call, capped input via the same
tail-preserving prep as the quality gate), +0 render cost by construction.
Hard caps: 10 ops, 4-min timeout, kill-switch env. Against the measured
$3.30 all-in article cost: ~4%.

## Explicitly out of scope

Cross-article canonical numbers (revisit per-niche when relevant); auditing
rendered diagrams (prevented upstream instead); syndication/newsletter
surfaces (inherit the corrected body by generation order); full-article
rewrites as a remedy (the editorial gate already owns that).
