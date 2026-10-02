# Places Trust: Link-First Resolution, Site-vs-Google Cross-Check, Admin Surfacing, Stated-Hours Open-Now

**Status: SCOPED — 2026-10-02. Four items, user-requested ("a must for good
usability") after the demo account's place resolution mis-matched twice
(a restaurant, then "Advantage ADHD & Psychiatry Services"). Builds on the
name-mismatch guard + probe-periods gating shipped in 9ff3484.**

Shared context: `resolvePlaceId` ([places.ts:60](../apps/api/src/lib/google/places.ts))
only honors URLs carrying a literal `place_id=` — real-world Maps share links
never do — so the clinic-provided link is thrown away and a name+address text
search does the matching. Everything downstream (hours, rating, open-now,
review harvest, review deep link) hangs off that one match.

---

## Item 1 · Link-first place resolution (root-cause fix)

**Goal:** the Maps/GBP link the clinic pastes is the authoritative source of
the Place ID. Text search becomes the no-link fallback only.

### Design

New resolution ladder inside `resolvePlaceId` (signature unchanged; all
callers — `probePlaceAndStore` in commits.ts, lazy path in context.ts —
benefit automatically):

1. **`place_id=` / `placeid=` param** — current behavior, kept (also covers
   pasted `search.google.com/local/writereview?placeid=…` links).
2. **Short-link expansion** — `maps.app.goo.gl/*`, `goo.gl/maps/*`,
   `g.co/kgs/*`: fetch with `redirect: 'manual'`, read `Location`, max 3
   hops, 5s timeout. SSRF posture: hop hosts must be on a hardcoded Google
   allowlist (`maps.app.goo.gl`, `goo.gl`, `g.co`, `www.google.com`,
   `maps.google.com`, `google.com` + country TLD variants via suffix check
   `\.google\.[a-z.]{2,6}$`); any off-list hop aborts to the next ladder
   rung. No request body, GET only, no credentials.
3. **Full `/maps/place/<name>/@lat,lng` URL parse** — extract the
   URL-encoded place name and the `@lat,lng` anchor; call Find Place with
   `input=<name>` + `locationbias=point:lat,lng`. This is the documented
   high-precision path: name + exact coordinates virtually eliminates the
   similar-name-in-suburb failure mode.
4. **FTID/CID attempt (best-effort)** — URLs carrying `!1s0x…:0x…` (ftid)
   or `?cid=…`: try legacy Details with `ftid=`/`cid=` in place of
   `place_id`. These params work on the legacy endpoint but are
   semi-documented — treat success as authoritative, any non-OK falls
   through to rung 3/5 silently. Verified by an integration test before we
   rely on it; drop the rung if it proves flaky.
5. **Name+address text search** — current fallback, last resort only.

### Provenance + guard interaction

- New nullable column `BrandSettings.googlePlaceIdSource` (`'link' |
  'search'`) + migration. Written wherever `googlePlaceId` is written
  (probePlaceAndStore, lazy path in context.ts, backfill script).
- The 9ff3484 name-mismatch guard changes behavior by provenance:
  - `source='search'` → mismatch **discards** the probe (current behavior).
  - `source='link'` → mismatch **logs + keeps** the probe. The clinic's own
    link wins even when the listing name differs (rebrands, "Dr Smith t/a
    Valley Chiro" cases) — but the discrepancy still surfaces via Item 3.
- **Re-resolution hook:** when `googleBusinessProfileUrl` changes through
  the brand-settings route, null `googlePlaceId`/`googlePlaceIdSource` and
  `clearAgentContextFor(accountId)` — pasting a corrected link is the
  self-service fix for a bad match (today a changed link does nothing).

### Files

- `apps/api/src/lib/google/places.ts` — ladder, `expandGoogleShortLink`,
  URL parsers (exported for tests).
- `packages/db/prisma/schema.prisma` + migration (1 column).
- `apps/api/src/onboarding/commits.ts` (`probePlaceAndStore` writes source).
- `apps/api/src/agent/context.ts` (lazy path writes `'search'`; guard reads
  provenance).
- `apps/api/src/routes/brand-settings.ts` (re-resolution hook).
- One-off backfill script (droplet): re-resolve accounts where
  `googleBusinessProfileUrl` is set and source ≠ `'link'`.

### Tests

Unit: ladder order with fixture URLs (every rung + malformed), allowlist
rejection (evil redirect hop), name-extraction from `/maps/place/` with
unicode names. Fetch mocked. One opt-in integration test (real key, env
gated) for ftid/cid viability.

**Effort:** ~half day + backfill. **Risk:** low — pure widening; worst case
every rung misses and we're exactly where we are today.

---## Item 2 · Website-vs-Google cross-check with discrepancy warnings

**Goal:** when both a website crawl and a Places probe exist, compare hours /
phone / address and warn the clinic (kb_review + Settings) and us (admin).
This is the originally-remembered feature; plan D2 deferred it to a pilot
log-check — this builds the real thing.

### Design

**a) Extraction** — new `apps/api/src/onboarding/site-facts.ts`:
one small-model LLM call (gemini-flash tier, structured JSON) over the crawl
pages' text (crawler already targets contact/about via `NAV_KEYWORDS`,
[site-analysis.ts:21](../apps/api/src/onboarding/site-analysis.ts); pass the
`pages[]` text, not just the 8k corpus slice, capped ~16k). Output:

```ts
interface SiteFacts {
  hours: { day: string; open: string | null; close: string | null; closed: boolean }[] | null
  phones: string[]        // as printed on the site
  streetAddress: string | null
  confidence: 'high' | 'low'   // low → no warnings, store only
}
```

Stored in `onboardingSession.stepData.siteFacts` + `siteFactsAt` (no
migration). Nulls everywhere when the site simply doesn't publish the info —
null never warns.

**b) Comparison** — pure function `compareSiteToGoogle(siteFacts, probe,
countryCode)` in a new `apps/api/src/lib/hours-compare.ts`:

- **Hours:** normalize both sides to per-day minute ranges via the shared
  parser from Item 4 (one parser, two consumers). Flag: open-vs-closed
  disagreement on any day, or boundary difference ≥ 30 min.
- **Phone:** digits-only, compare last 9–10 digits (country-aware). Any
  site phone matching = no flag (sites list multiple lines).
- **Address:** flag only when street *numbers* differ or street-name token
  overlap is zero — suite/formatting noise must not warn.
- Output: `{ field, website, google, note }[]` — empty array = agreement.

**c) When it runs** — inside `probePlaceAndStore`
([commits.ts:840](../apps/api/src/onboarding/commits.ts)), after the probe,
best-effort async (never blocks onboarding, mirroring the existing posture).
Re-runnable from Settings save (cheap: extraction is cached in stepData;
only the compare re-runs unless the site was re-crawled).

**d) Surfaces**

1. **kb_review card** (flow.ts `prepare` → `card.discrepancies`;
   [cards.tsx](../apps/web/src/app/embed/cards.tsx) renders an amber panel
   above the existing hours-confirm block):
   > *Your website says Saturday 9:00 AM – 1:00 PM, but your Google listing
   > says closed Saturday. Patients see the Google version — worth fixing
   > on Google, and confirm the correct hours below.*
   Informational only; resolution = the clinic edits/confirms in the
   per-day editor that already exists.
2. **Settings · ChatKnowledgeSection** — GET payload gains
   `discrepancies`; same panel above the hours textarea.
3. **Admin** — one `ErrorLog` row (`errorType: 'places_site_mismatch'`,
   details in `context` Json), deduped per account per field-set; rides the
   existing /admin/errors view + resolve toggle (same vehicle as Item 3).

### Cost / latency

One flash-tier call per onboarding (±re-checks), ~$0.001, 2–4 s, async.

### Tests

Extraction: prompt-fixture tests with 3 synthetic site texts (clean, hours
on contact page, no hours at all). Compare: table-driven — agreement,
day-closed disagreement, 30-min boundary, multi-phone match, suite-number
noise (must NOT flag), null site facts (must NOT flag).

**Effort:** ~1–1.5 days (the LLM extraction + two UI panels carry it).
**Risk:** medium-low; worst failure mode is a false warning, which is
informational and dismissible by design.

---

## Item 3 · Mismatch warnings into the admin view (closes plan D2)

**Goal:** the name-mismatch guard warning (currently a `logger.warn` only)
becomes a visible, resolvable admin item.

### Design

- In the guard branch ([context.ts:112](../apps/api/src/agent/context.ts)):
  write an `ErrorLog` row — `userId: brand.userId`, `errorType:
  'places_listing_mismatch'`, message `Google listing "<listing>" doesn't
  match brand "<brand>" — probe ignored`, `context: { accountId, placeId,
  listing, brand, source }`.
- **Dedup:** skip the write when an *unresolved* row with the same
  `errorType` + `context.placeId` + `userId` exists — the guard fires on
  every 15-min bundle rebuild and must not flood the table. (findFirst on
  errorType+userId then Json check; no new index needed at this volume.)
- Surfaced automatically in the existing /admin/errors page (filter +
  resolve toggle already there). No new UI.
- **Fix path** (depends on Item 1's re-resolution hook): admin or clinic
  pastes the correct Maps link → `googlePlaceId` nulls → next bundle
  re-resolves link-first → row gets resolved manually.
- Email alert via `alerts.ts` deliberately **not** included — pre-launch
  volume is near zero and the errors page is checked; revisit if a pilot
  shows mismatches going unnoticed.

### Files

`apps/api/src/agent/context.ts` (guard branch), test covering dedup.

**Effort:** 2–3 hours. **Risk:** minimal.

---

## Item 4 · Open-now computed from user-stated hours

**Goal:** accounts with user-entered/confirmed hours get the server-computed
"Open now — closes at 6:00 PM" verdict back. Today, gating the probe's
periods (correct) leaves `openStatusFor` returning `{known:false}` whenever
`brand.openingHours` is set — the agent states hours but can't assert
open-right-now.

### Design

**a) Parser** — `parseWeekdayText(text): PlacePeriod[] | null` in new
`apps/api/src/lib/hours-parse.ts` (shared with Item 2's comparator).
Accepts, high-confidence only:

- Google weekday_text lines: `Monday: 8:00 AM – 6:00 PM` (the dominant
  format — kb_review hours are Google-seeded then confirmed/edited).
- Human variants: `Mon–Fri 8am–6pm`, `Sat 9-1`, `Sunday: Closed`,
  `Open 24 hours`, split shifts (`9:00 AM – 12:00 PM, 2:00 – 6:00 PM`),
  hyphen/en-dash/em-dash separators, 24h times.
- Output in the legacy `PlacePeriod` shape (day 0=Sunday, `"HHMM"`) so
  `computeOpenStatus` ([hours.ts:40](../apps/api/src/agent/hours.ts)) is
  **unchanged**.
- **Any line it can't parse → return `null` for the whole text.** Partial
  guesses are worse than `{known:false}`; the agent still has the raw text.

**b) Timezone** — user hours carry no UTC offset. Resolution chain:

1. IANA zone from `brand.newsletterTimezone ?? brand.promoEmailTimezone`
   (both exist on BrandSettings, defaulted `America/New_York` — but use
   only when *explicitly set*, the default would lie for non-US clinics) →
   offset computed at call time via `Intl.DateTimeFormat` (DST-correct,
   better than any stored fixed offset).
2. `probe.utcOffsetMinutes` — only when the probe survived the guard
   (matched or link-trusted listing).
3. Neither → `{known:false}`, as today.

**c) Wiring** — context.ts: when `brand.openingHours` is set,
`periods = parseWeekdayText(brand.openingHours) ?? undefined` and attach
the resolved offset; probe periods stay gated exactly as shipped.

### Tests

Table-driven parser suite (every format above + garbage lines + mixed
parseable/unparseable → null), DST boundary test for the Intl offset
(fixed dates either side of a US + AU transition), context assembly test:
stated hours → verdict present; unparseable stated hours → `known:false`.

**Effort:** ~half day. **Risk:** low — parser failure degrades to exactly
today's behavior by construction.

---

## Sequencing & shared pieces

| Order | Item | Why this order |
|---|---|---|
| 1 | **Item 1** link-first + provenance + re-resolution hook | Root cause; Items 3's fix-path and 2's probe trust depend on provenance |
| 2 | **Item 3** admin surfacing | 2–3h, rides Item 1's provenance field |
| 3 | **Item 4** hours parser + stated-hours open-now | Parser is a dependency of Item 2's comparator |
| 4 | **Item 2** site-vs-Google cross-check | Consumes the parser; biggest piece last |

Total: ~2.5–3 days of build across two deploys (1+3 together, then 4, then
2). Backfill + demo-account re-resolve after the first deploy.

## Decisions needing sign-off

1. **Link-trusted mismatches keep the probe** (Item 1) — clinic's own link
   beats the name guard; warning still raised. Confirm.
2. **Timezone sourcing** (Item 4) — reuse newsletter/promo IANA zones when
   explicitly set. Alternative: a dedicated `clinicTimezone` field asked at
   onboarding (cleaner, +1 onboarding question + migration). Default scope
   is reuse; say the word for the dedicated field.
3. **Discrepancy panel is warn-only, never blocking** (Item 2) — the
   existing hours-confirm gate remains the only hard gate. Confirm.
