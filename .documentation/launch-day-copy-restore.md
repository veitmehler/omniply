# Launch-Day Copy Restore (September 22, 2026 — shifted from Sept 15 on 2026-09-10 (final))

Every price mention and sales CTA removed pre-launch (commit f3d917b,
2026-08-08), verbatim, with its restore location. The notify-pitch blocks
auto-expire (date-gated to 2026-09-22T14:00Z) — but the ORIGINAL copy below
must be put back by hand where noted. Full diff reference:
`git show f3d917b` (removed side) / `git show 7211e3f:<path>` (originals).

## 1. apps/web/public/x-ray/index.html

**Walkthrough CTA box** (restore inside `#s-results`, after the leakcard,
once the video exists — independent of launch):
```html
<div class="ctabox">
  <a class="btn" id="cta" href="/walkthrough">Watch the 12-minute Practice Autopilot Walkthrough &rarr;</a>
  <div class="under">No call. No pressure. The exact system, on screen.</div>
</div>
```

**Punch line** (both render sites, ~lines 784/850 — restore the price
multiple):
```js
$('punch').innerHTML = 'That’s &asymp; <b>' + r.priceMultiple + '&times;</b> the monthly cost of fixing it. Recovering <b>one patient a month</b> pays for the whole system.'
```
(`PRICE_MONTHLY: 397` and the `priceMultiple` computation were left in the
code, so this is a one-line swap back.)

## 2. apps/web/public/walkthrough/index.html — the buy box
```html
<div class="buy">
  <div class="price">$397<small> / month</small></div>
  <p>Everything in the walkthrough — content engine, AI chat &amp; voice, review engine, recall &amp; reactivation — set up for your practice. Cancel anytime.</p>
  <a class="btn" id="checkout" href="#">Put my practice on autopilot</a>
  <div class="under">Setup in days, not months · no lock-in</div>
</div>
```
Also set `CONFIG.CHECKOUT_URL` to the live GHL purchase link (still empty).

## 3. apps/web/src/app/chiropractors/page.tsx

**FAQ question** (answer was untouched):
```
q: 'What exactly does $397 include? Any hidden costs?',
```

**Economics paragraph sentence**:
```
it. The whole system costs $397 a month. <strong>One recovered patient covers it. The second one is
profit.</strong> That&apos;s the entire business case...
```

**Restore `<PricingBlock vertical />`** where `<FoundingNotify />` sits in
the Economics section (component still exists in Marketing.tsx, unused).
Re-add `PricingBlock,` to the Marketing import.

**Close paragraph**:
```
$397 a month. Everything in the loop. Cancel anytime. We&apos;re not asking you to become a
marketer... we&apos;re asking you to stop having to be one.
```

## 4. apps/web/src/app/home/page.tsx

**Meta description** (restore tail):
```
'One loop, four systems: content in your voice, instant AI response, compounding Google reviews, and patient recall. You approve, it ships. $397/mo flat.'
```

**FAQ question**:
```
q: 'What is included in the $397?',
```

## 5. Story-post personal-profile window (set 2026-09-03)

Automated story beats route to Veit's PERSONAL LinkedIn except during the
hand-crafted launch-arc window. Flip history + remaining flips (one JSON
update each — ask Claude; personal profile account id =
`6a74aeb42a6422d37b0b2eac_HsevyaesOdFid7b8KC9q_E5XnjQ2Xax_profile`,
azavea owner `cmsgxchc40000pa2igbkg8efy` on prod):
- Sep 9 morning: UNSET (done) — original launch window.
- Sep 10: RESTORED (done — launch moved to Sept 22; normal content resumes).
- **Sep 16 morning (Wed): UNSET again** — launch-arc posts take over the
  profile through the Sept 22 launch. (Session cron armed 2026-09-10; if
  the session died, run the unset by hand.)
- **After Sept 22 launch: RESTORE linkedinPersonal AND re-add the 3 parked
  narrator beats** (Dec-2022 plugin / postponed-launch /
  engine-kept-producing) to brand_settings.storyBeats — parked so
  automated arcs can't repeat the launch posts' stories on the profile.

## 5b. GHL launch-morning actions (not code)

- Re-enable the checkout orderform (taken offline after the test purchase).
- **Insert the real checkout link into all three W2 "Launch Blast" emails**
  (placeholder [CHECKOUT LINK] in each) and the real spot count [N] into
  Email 2 — then bulk-add the `launch-blast` tag to the waitlist smart list
  to start the drip. W2 waits must be back at 2 days (dry-run used 5 min).
- Verify W2 is PUBLISHED before adding the tag (it was kept off pre-launch).

## 6. What does NOT need restoring

- The notify-pitch blocks hide themselves after 2026-09-22T14:00Z
  (x-ray + walkthrough statics and the FoundingNotify React component all
  date-gate). Remove them at leisure post-launch.
- `PricingBlock` component: never deleted.
- The waitlist endpoints keep working (harmless post-launch; joins just
  stop arriving).
