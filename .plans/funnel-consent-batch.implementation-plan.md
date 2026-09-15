# Funnel + Consent Batch (§4b-3) — SPINE-only CTA, install consents, GHL-first socials

## STATUS 2026-09-15: EXECUTED — live on prod (74827a9). Demo patch (G) superseded by the full RESET; fresh E2E run validates everything.

Decisions locked with Veit 2026-09-15 (mid-E2E). One API+web batch, one small
migration. Supersedes the "PENDING VEIT DECISION: WP publish consent toggles"
item in pre-launch-todos §4b-2.

## A. CTA step → social lead-gen consent (SPINE is the only funnel)

The old choice step is a trap: the SPINE comment→DM funnel is the only wired
machine; every other option silently deactivates it. Live E2E proof: synthesis
REPLACED the option list with 3 LLM-generated text lines — Veit was never even
shown the SPINE option and "picked wrong" through no fault of his own.

1. Step keeps id `cta` (no session-resume breakage), becomes a two-option
   choice with the consent pitch as its messages (Veit's copy, amended):
   - "As part of Omniply, you can get a full lead-generation quiz installed
     on your website automatically. Quizzes are the best way for social media
     followers to become leads. Once they complete the quiz, they're
     subscribed to your newsletter and get offers to book an appointment."
   - "If you enable this, we'll add a page to your website automatically —
     safe and reversible, you can remove it anytime."
   - "Every social media post then tells readers they'll get the quiz link
     messaged to them when they reply \"SPINE\" on any of your posts."
   - Buttons: **"Yes, please set this up."** /
     **"No, I don't want to generate leads from my social media activity."**
2. YES → `socialCallToAction='SPINE|our 2-Minute Spine Check'`,
   `socialPrimaryGoal='dm_keyword'`, consent flag quiz=true.
3. NO → phone-first fallback CTA (Veit decision): captions say
   "Call us at {phone} to book your appointment." (no phone → booking-URL
   CTA → generic). `socialPrimaryGoal=null`, quiz=false; the finale SKIPS
   the quiz-page publish + trigger-link repoint.
4. DELETE `generateCtaOptions` (LLM call + ctaOptions stepData — dead code).
5. STEP ORDER: move `wordpress` BEFORE `cta` (Veit #4: connect the site,
   then pitch what we install on it). New tail order:
   … offers → booking_url → pms → wordpress → cta → socials → gbp →
   google_reviews → front_desk → kb_review → toggles → install_consent → final.

## B. New `install_consent` step (end of onboarding, before `final`)

Consent for the OTHER two WP installs (quiz consent lives in A):
- Copy: link-in-bio page (/linktree — where social profiles' bio link points)
  + website chat assistant (the Omniply Connect plugin). "Safe and
  reversible — you can remove either anytime."
- confirm_card with two toggles, both default ON: "Publish my link-in-bio
  page" / "Add the chat assistant to my website". Continue button.
- Finale honors: `publishLinktreePage` only if linktree=true;
  `installOmniplyConnect` only if chatWidget=true.

## C. Consent storage

`BrandSettings.installConsents Json?` — `{ quiz, linktree, chatWidget:
boolean }` (migration). One source of truth for the finale, captions logic,
and future Settings kill-switches (Settings toggles stay post-launch
backlog). Missing field (pre-batch accounts) = treat as consented
(grandfathered — demo already has everything installed).

## D. Quiz → newsletter tag wiring (makes the copy's promise TRUE)

- Spine-check capture endpoint: ALSO apply the clinic's newsletter tag
  (GhlSettings.newsletterTagName/Id) to the upserted contact → quiz takers
  genuinely enter the newsletter audience.
- Quiz capture screen fine print gains: "…and you'll receive our monthly
  health letter — unsubscribe anytime." (consent hygiene for the
  auto-subscribe).

## E. socialCallToAction consumer audit (pipe format must never print raw)

`SPINE|our 2-Minute Spine Check` is a machine format. Verified consumers to
fix/check during build:
- leadgen compile `bookingCta` (PDF back page) — on pipe/dm_keyword: use
  "Call us to book your appointment" (the back-page phone CTA box).
- caption/story hooks — already parse the pipe format (P3); re-verify.
- any other `socialCallToAction` readers (grep sweep; newsletter CTA?).

## F. GHL-first socials (Veit decision: Social Planner > site crawl)

- `commitSocials` already lists connected accounts — construct PUBLIC URLs:
  instagram.com/{username}, facebook.com/{pageId}, linkedin.com/company/{id}
  (verify listGhlAccounts detail fields carry the platform ids; fetch
  per-account detail if not). Merge into brandSettings.socialMediaLinks:
  GHL wins per platform, crawl-harvested fills the rest, BP prefill last
  (the crawl+prefill persist at brand_profile_confirm from aced303 stays).
- Feeds newsletter footer icons + linktree icon row automatically.

## G. Demo-account data tasks (after deploy)

1. SPINE patch: socialCallToAction/'dm_keyword' as if one-tap was chosen
   (unblocks the E2E comment-DM leg).
2. installConsents = all true (everything is already installed).
3. Socials: build URLs from stored socialAccounts → socialMediaLinks →
   re-publish linktree (icon row appears).
4. Re-verify PDF bookingCta doesn't regress on the pipe value (E consumer
   fix rides the same deploy as the SPINE patch — patch AFTER deploy).

## H. Docs/tests

- Update onboarding-test-simonchiro.md verification lines (CTA step is now
  the quiz consent; expected stored values; install_consent step exists).
- flow tests: new step order + install_consent + cta consent commits;
  render/compile tests for the bookingCta pipe guard.
- pre-launch-todos: mark §4b-2 consent-pending item DECIDED→this plan;
  §4d (embed content review surface) unchanged, still open.

## Order of work

1. Migration + schema (installConsents).
2. A+B+C flow/commits/UI (+ delete CTA generation).
3. D capture tag + fine print. E consumer sweep. F socials.
4. Tests green → staging deploy → verify → main → prod.
5. G demo tasks + linktree re-publish.
6. H docs.
