# Omniply Brand Consolidation — implementation plan

> DATE NOTE 2026-09-10: launch moved Sept 8→15→**22 (final)**. Sept 8 refs below are historical.

**Status: PLAN — 2026-08-08. All decisions user-locked:** static HTML for
azavea.ai · essays auto-publish to omniply.io/articles (azavea vertical
ONLY — clinics keep WordPress) · Azavea subaccount link domain →
links.omniply.io (user) · dark navy (#052234 family) + lime everywhere ·
new Omniply socials (user) · Omniply USPTO clean → file now · backfill a
small set of consolidated articles (article-only, no social).

Hard dates: Mon Aug 10 cadence run (hold Publish until Phase A is live) ·
social promotion opens after Phases A–E · launch Sept 8.

---

## Phase A — omniply.io/articles + internal publish target (code, 1–2 sessions)

The pipeline stays invariant; this adds a **registered output target**
(the registry is the designed extension point) used by the azavea account
only. Clinics: untouched, WordPress as always.

1. **Internal target** (`output/internal-target.ts`): on approval, mark the
   SitePage published with a slug + canonical URL
   `https://omniply.io/articles/<slug>`; no upload anywhere — the rendered
   HTML already lives in our DB. Target selection: azavea-vertical accounts
   without/regardless of WP connection use `internal`.
2. **Public API**: `GET /api/articles` (published list: title, slug,
   excerpt, featured image, date) + `GET /api/articles/:slug` (full
   rendered HTML + meta + JSON-LD). Public, cached, azavea-account scoped.
3. **Next.js routes**: `/articles` index + `/articles/[slug]` (ISR),
   reusing `article-typography.css`, navy+lime layout, OG/Twitter meta from
   the featured image, JSON-LD embedded. Plus `sitemap.xml` entries + RSS.
4. **Downstream URLs**: syndication (LinkedIn/Medium variants), promo
   emails, and social captions resolve `article_url` from the internal
   target's canonical URL. One resolution point, verified in E2E.
5. **Migrate essay 1402** (patient drift) into the internal store; upcoming
   cadence essays flow automatically.
6. Monday Aug 10 flow: cadence generates → user HOLDS approval until this
   phase deploys → approve → first internally published essay.

## Phase B — navy + lime tokens everywhere (small)

- `TOKENS` in Marketing.tsx: `ink`/`inkDeep` → navy pair (base **#052234**,
  lighter gradient partner ~#0A2A3F); accent/lime unchanged.
- Static funnels (x-ray, walkthrough): swap the `--bg0/--bg1` CSS vars to
  the navy pair.
- FoundingNotify card + footer already read tokens → free.
- Contrast check lime-on-navy (passes: lime #C3F43B on #052234 ≈ 12:1).

## Phase C — azavea.ai static business card (half session)

STATUS 2026-08-13: SITE BUILT + DEPLOYED. Awaiting user DNS change, then WP deletion.

- DONE: `sites/azavea-ai/` in repo (4 hand-written pages: Home, Contact
  [email + link to omniply.io/contact, no form], Terms, Privacy; navy+lime,
  white logo, no framework). Deployed as own Vercel project `azavea-ai` in
  team azavea-media → https://azavea-ai.vercel.app. Domains azavea.ai +
  www.azavea.ai attached. sitemap.xml (4 URLs) + robots.txt live.
- DONE: `vercel.json` 410s verified live for /product/*, /listing/*,
  /shop/*, /news/*, wp-* paths, xmlrpc.php, and ALL unknown paths
  (catch-all 410 — old article slugs included).
- DONE: cold archive of the WP content via public REST →
  `../azavea-ai-wp-archive/` (189 posts, 18 pages, 672 media + files).
- USER: Cloudflare DNS — `A @ 76.76.21.21` + `CNAME www cname.vercel-dns.com`,
  both DNS-only (grey cloud). Touch ONLY these two records: MX stays
  (team@azavea.ai mail/GHL login), school.azavea.ai (Vercel/motek),
  leads.azavea.ai (Vercel/medici-leads), crm.azavea.ai stay untouched.
- USER: after site verified on domain → delete the WordPress on Hostinger
  (optionally grab a Hostinger panel DB dump first; REST archive exists).

## Phase D — GSC cleanup (user + me, ~1 hour; answer to "fastest way")

Order matters — do AFTER the static site is live so ghosts 404/410:
1. GSC → **Removals → New request → "Remove all URLs with this prefix"**
   for `https://azavea.ai/product/`, `/listing/`, `/shop/`, `/news/` (and
   the www property equivalents). Hides them from results within ~24h;
   the 410s make it permanent as Google recrawls.
2. **Sitemaps**: delete every registered sitemap (especially any you don't
   recognize — hack sitemaps are how the spam got indexed); submit the new
   5-URL sitemap.
3. **Security & Manual Actions** tabs: verify both clean; if a hacked-site
   flag exists, request review citing the full rebuild.
4. Property hygiene: keep azavea.ai + www verified so removals cover both.
5. Done. Residual index entries decay over weeks — invisible via the
   removal tool in the meantime, and nothing links to them.

## Phase E — GHL + identity config (mostly user)

- links.omniply.io as the Azavea subaccount's link/brand domain (USER —
  re-send yourself one trigger-link DM afterwards to confirm).
- **Sending domain: verify omniply.io** in the location email settings;
  switch promo-email sender to e.g. `veit@omniply.io` (I flip the config).
  Retires the azavea@azavea.ai plan.
- **New Omniply socials** (USER creates FB page / IG / LinkedIn) → connect
  in GHL → I remap the azavea account's `accountIds` to the new accounts
  and verify with a test post.
- azavea account brandSettings: organizationName/logo → Omniply branding
  (social templates + captions render the new identity).
- Old Azavea-branded socials: retire quietly after the switch.

## Phase F — backfill articles (config + supervised runs)

Consolidate the old site's only-worth-keeping themes into **6 strong
Omniply-positioned articles**, generated through the azavea pipeline as
**article_only topics** (mode exists — skips social generation entirely),
reviewed and published to /articles with dates spread over recent weeks:

1. "What AI marketing automation actually does for a small local business"
   (consolidates the AI-marketing-company cluster)
2. "Speed to lead: why the fastest practice wins the patient" is cadence
   material already — backfill twin: "Never miss another inquiry: what
   24/7 AI response looks like for a local practice" (call-handling
   cluster)
3. "The honest ROI math of AI for a small business" (ROI/affordability
   cluster)
4. "AI chatbots for customer service: what's real and what's hype"
   (chatbot-misconceptions cluster)
5. "How AI content marketing compounds for local businesses" (content
   cluster)
6. "Choosing between custom AI and off-the-shelf tools as an SMB"
   (build-vs-buy cluster)

Each: belief-arc-lite, Omniply mentioned once, X-Ray/notify CTA footer.
The 189 originals die with the WordPress; these six are their distilled
replacement.

## Trademark filing (answer: yes, you can likely self-file)

**The one gating condition**: USPTO requires a US-licensed attorney for
**foreign-domiciled** applicants. If Azavea Inc. is a US-incorporated
entity with a US address, you can self-file; if the company is domiciled
abroad, you must engage a US attorney (fixed-fee services run $500–900
incl. government fees).

Self-filing route (~30–45 min):
1. USPTO.gov account → Trademark Center → new application.
2. Mark: standard characters, **OMNIPLY**. Owner: Azavea Inc.
3. Classes: **042** (SaaS — pick a pre-approved ID Manual description like
   "Software as a service (SAAS) services featuring software for marketing
   automation") + optionally **009** and **035**. Using ID Manual
   descriptions keeps the base fee at $350/class and avoids the $200
   custom-description surcharge.
4. Filing basis: **1(b) intent-to-use** is simplest pre-launch (you swear
   bona fide intent; after launch you file the Statement of Use, +$150/
   class, with a specimen — a screenshot of omniply.io showing the mark
   with the service and a way to buy). If you consider the July test
   purchase "use in commerce," 1(a) with a current specimen also works —
   1(b) is the lower-risk default.
5. Coined word + clean search = low office-action risk. The same attorney
   hour recommended for the AZAVEA question can sanity-check the filing.

## Sequencing

| When | What |
|---|---|
| Before Mon 08:00 UTC or same day | Phase A build starts; user holds Monday's approval until A deploys |
| Week of Aug 10 | A live → publish Monday essay internally · B tokens · C static site + WP kill · D GSC sweep |
| Same week (user) | links.omniply.io setting · omniply.io sending domain · new socials · trademark filing |
| After socials connected | E remap + test post → **social promotion opens** |
| Following week | F backfill articles reviewed + published |
| Sept 8 | Launch (waitlist gates auto-open; restore-copy checklist) |
