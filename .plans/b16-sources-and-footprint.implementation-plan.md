# B16 — Sources that are real, checked and sufficient; footprint neutral

Status: PLAN, agreed in discussion with Veit 2026-11-09. Nothing implemented. No batch runs without an explicit go.

Builds on B14 (consolidated writer prompt, editor pass) and B15 (source identity verification, fact-anchored citations, inline devices retired). Gemini's B15 round: prose passes as human on 2 of 3 and passes E-E-A-T on 3 of 3; the one "AI" verdict came from the CDN hostname in the bench's raw HTML, not from the text. What remains is the source chain and the shared markup footprint.

## 0. What B15 measured (the reason for this plan)

| finding | number |
|---|---|
| research tags whose identifier pointed at an unrelated paper (sciatica feed, steps 7+8) | 68 of 102 |
| tags with no URL when the prompt asked for the specific page only (stiffness, step 8) | 37 of 37 |
| fact sources placed by code on back pain, then lost in the LLM inserter pass | 11 placed → 1 survived |
| final citation links per article | 1 / 0 / 1 |
| bottom-of-page "Article Citations" list | built from the RAW step-12 output, no verification; B14 sciatica's stored list contains the dermatology PubMed id |
| fact checker's view of our sources | none (receives article text only) |

Principle for the round: a URL is never typed by a model. It comes from a page Google retrieved for that sentence, or from a PubMed/Crossref lookup by title, and it is checked for identity, tier and support before anyone writes from it.

## 1. Rulings already made

- Qualitative claim whose source fails the support check: the claim stays, the link goes.
- Figure (any number, rate, percentage, count, duration) whose source fails the support check: the fact is dropped from the feed entirely. An unsupported number in a health article is the one thing we do not publish.
- Authority is decided by host tier in code, never by a model's rating.
- Step 6 (questions people ask) moves to real Google PAA data if the probe confirms depth; the model only dedupes and ranks.
- Step 12 is retired as a discovery step. The references list is built from sources actually used.

## 2. Work items

### A. Inserter ordering fix + link guard (bug from B15)
- `executor.ts` step 12.5: run the LLM leftover pass FIRST on the unanchored pool, then `anchorFactSources()` on its output. Anchoring skips sentences with markup, so no double links.
- Guard in `citation-inserter.ts`: before accepting a model pass, verify every `<a href>` present in its input is still present in its output; otherwise discard the pass and keep the input.
- Metric: `fact sources placed` must equal links present in step 11 after the pass.

### B. Grounding supports → fact-to-page pairing
- `llm/gemini.ts` search path: capture `groundingMetadata.groundingSupports[]` (`segment.text`, `groundingChunkIndices`) alongside chunks; expose on `LLMResponse` as `groundingSupports: Array<{ text, chunkIndices }>`.
- `step-runner.ts`: pass supports through `StepRunResult` (both standard and fallback paths).
- `executor.ts` steps 7/8: resolve chunk URIs (existing `resolveGroundingUrls`), then for each parsed fact find supports whose segment text overlaps the fact (content-term overlap, same helper as the verifier) → candidate real pages for that fact.
- `source-verify.ts`: candidate order per fact = tag URL (if identity passes) → grounding-support pages (policy + title check) → PubMed title repair → none. Status values gain `grounded`.
- Step 12's chunks are no longer needed (step 12 retired, see F).

### C. Research prompt: tiers named, URL rule relaxed back
- `article-writer-prompts.ts` RESEARCH_SYSTEM_PROMPT: name the acceptable tiers (peer-reviewed papers and systematic reviews; national health bodies; professional colleges; major university and hospital systems; nothing commercial, no clinic or product sites, no aggregators). Ask for the fact first, the tag last, and a URL "when you have the specific page"; the withheld-URL rule from B15 is dropped because grounding supports now supply the page.
- Keep: claim-first, provenance only in the tag, [OBS] tagging.

### D. Support check (the "does the source say this" layer)
- New `source-support.ts`: for each fact with a surviving URL after identity + tier:
  - PubMed/PMC: fetch the abstract via NCBI efetch (free, queued at the existing rate limiter).
  - other hosts: fetched page text (first ~6k chars; Oxylabs scraper for bot walls).
  - one small-model call (Gemini 3.1 Flash-Lite or Haiku 5.5, ~1k tokens): input = fact + source text; output JSON `{ verdict: supported|partial|unsupported, quote }`. Prompt is a yes/no evaluator, no creativity, code-validated output.
  - `partial` counts as supported for qualitative claims and as unsupported for figures.
  - Apply the rulings in §1: qualitative → tag loses URL; figure → fact removed from the feed (and logged).
  - The `quote` is stored with the fact (new tag field or a side map in ctx + persisted as synthetic step 121) for the fact checker (E).
- Cost target: ≤ $0.03 per article. Runs in parallel per fact after steps 7 and 8.
- Kill switch `SOURCE_SUPPORT=0`.

### E. Fact checker reconciliation (step 10)
- New prompt variable `{{verified_facts}}`: the list of facts with URL + supporting quote.
- Step 10 prompt: first reconcile every sourced claim in the article against this list (number drift, scope drift such as radicular vs non-radicular), then search only for claims not covered. Output format unchanged (issues JSON) so step 11 is untouched.
- Canonical text in `article-writer-prompts.ts`; apply via the apply script.

### F. Step 12 retired; references list from used sources
- `SEARCH_STEPS`/`SEARCH_JSON_STEPS`/`PHASE_A_STEPS`: step 12 removed from the run (row kept inactive for rollback).
- Pool = verified fact sources (+ grounding-support pages) only; policy, liveness and anchoring unchanged.
- `approval-service.ts` `buildTwoTierCitations`: Tier 2 (rendered "Article Citations" list) = sources linked in the article in order of appearance, plus verified fact sources used but unanchored. No raw step-12 input anywhere. Tier 1 storage kept for the admin UI.
- Verified-source floor = a MINIMUM (ruling 2026-11-09): if fewer than 6 verified sources survive after D, run a targeted PubMed fill per H2: esearch with the section's key terms, publication types review/meta-analysis/guideline, last 10 years; candidates go through title check + support check like any other source. Filled sources may appear in the references list and may be linked where a sentence already states the fact; they never introduce new claims into the prose. No maximum beyond the existing inline pool cap of 14. Bench reports `floor hit`.

### G. Step 6 via Oxylabs (DECIDED 2026-11-09: switch)
- First build step: 3 parsed `google_search` requests on the bench topics (geo = client location) to see the exact parsed shape and PAA depth the API returns, so the dedupe and ranking code is sized to real data. This is a sizing step, not a decision gate.
- `faq-oxylabs.ts` fetches PAA + related searches for the primary keyword and the two salient entities; code dedupes against the keyword list and strips local-intent modifiers; one ungrounded Flash call ranks and selects 8 against the outline. Step 6 grounded call removed (row kept inactive for rollback). Reuses `newsletter/oxylabs.ts` request shape.

### H. Bench mirrors production
- `bench-build.py`: raw HTML rewrites `cdn.omniply.io/...` image sources to the clinic domain's media path (what the WordPress publisher produces), so the judge sees what readers and Googlebot see.
- New metrics: verified sources per article (verified / grounded / repaired / dropped-figure / unlinked-qualitative), links present, floor hit, support-check verdict counts.

### I. Markup footprint neutralised (white-label)
- Class names: `plain-gloss` → `term`, `plain-language-box` → `note`, `article-toc` → `toc`, `key-takeaways` → `summary`, `article-diagram` → `figure-diagram` (CSS in render + WordPress styles updated together; existing published articles keep working because styles are inline or theme-side — verify).
- Figure/caption ids derived from the heading slug, not from the job id.
- `aria-label` text generic.
- Media hostname for HTML/bundle targets: PARKED (Veit 2026-11-09, WordPress-only focus for now). WordPress clients already get images in their own media library.

### J. Small B15 follow-ups
- Boundary restore: if step 9 contained a first-person boundary sentence (hedge-gate BOUNDARY family + the B14 fresh-form patterns) and step 11 does not, log it and re-insert the step-9 sentence into the matching section when a near-identical neighbouring sentence exists; otherwise log only. Bench metric `boundary lost at step 11`.
- Recap: when the prose "Short version" fails the form gate twice, fall back to the bullets variant deterministically.
- Bot-wall fix (already committed 6a2f6fe9) rides along.

## 3. Order of work

1. A (bug), J (small) — same day.
2. B + C (grounding supports + prompt) — the source of real URLs.
3. D (support check) + E (fact checker) — the "does it say this" layer and its consumer.
4. F (step 12 retired, references from used sources, floor + PubMed fill).
5. H (bench) — before the batch.
6. Batch B16 (same three topics), Gemini round.
7. G (step 6 via Oxylabs) — in parallel with 2–4, ships with B16.
8. I (footprint) — independent, ships with B16 or after.

## 4. Acceptance for B16

- Links per article ≥ 8, every one a verified or grounded source anchored on the sentence that states its fact.
- Zero source tags with an unrelated paper surviving to the writer (bench counts resolved-title mismatches at 0 after verification).
- Zero figures in the article without a supported source.
- "Article Citations" list = the links in the article, nothing else.
- Prose metrics hold at B15 levels (source metadata 0, study years 0, hedges 0, silent sections ≤ 1, inline devices 0).
- Gemini round: 3 of 3 pass E-E-A-T; AI verdicts no longer cite the hostname.

## 5. Costs

Removed: step 12 (grounded Gemini + JSON call, ~$0.05), step 6 grounded fee if G lands ($0.035 + tokens). Added: NCBI/Crossref lookups (free), support check (~$0.02–0.03), Oxylabs SERP (~$0.01). Net per article: slightly lower than today.

## 6. Decisions (all resolved 2026-11-09)

1. Floor = minimum of 6 verified sources; PubMed fill feeds references and existing claims only, never new prose.
2. Media hostname for non-WordPress clients: parked, WordPress-only focus.
3. Step 6: switch to Oxylabs PAA; the three-request fetch is a sizing step, not a gate.
