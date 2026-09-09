# Onboarding E2E Test — simonchirocenter.com (user-owned test site)

Feature under test on top of the standard 19-step walkthrough
(.documentation/onboarding-testing-guide.md): blog-scrape writing sample with the
mandatory "I wrote this" authorship confirmation (deployed to staging, branch commit
"feat(onboarding): scrape newest blog post…").

## Pre-test checklist

USER (site + accounts):
- [√] Publish the planted article below to /blog on the WordPress site (title as given).
- [√] WordPress → Settings → Reading → "Discourage search engines" ON — BEFORE the test.
- [√] Create FB + IG (optional LinkedIn) profiles under unrelated names; add their links
      to the site header/footer (tests the crawl's socialLinks prefill).
- [ ] Staging test sub-account GHL Business Profile: name, user-controlled email, phone,
      US address (Mesa AZ), timezone America/Phoenix, website URL = the test site.
- [ ] Connect the social profiles in the sub-account's Social Planner.

ME (before you click "start"):
- [ ] Staging deploy green, seed state per guide Part C (owner User/Account/GhlSettings
      rows; NO BrandSettings — onboarding must fill everything).
- [ ] Tail staging logs live during the walkthrough.

## Extra verifications (on top of guide Part D table)

P3 client-rollout additions (2026-09-09):
- Voice questions are SIX now — q_moments answer lands in BrandSettings.storyBeats.
- CTA step offers "Send a free guide when they comment a keyword" — pick it,
  verify socialPrimaryGoal='dm_keyword' + 'KEYWORD|asset' stored.
- NO ElevenLabs step appears (removed for clients).
- Finale burst: article days = story beats + KT music video (headline+shorts);
  newsletter days = nl story beats + brand-tint feature carousel; captions use
  the CLIENT keyword (not XRAY); hours 9/12/17.

- Step 2 (crawl): log shows blogSample stored — url + wordCount ≥ 400, WP REST path.
- Step 7 (writing sample): chat offers the planted article with excerpt; answer exactly
  `I wrote this`; verify Settings.writingStyle afterward ECHOES the fingerprint below.
- No GBP connected → reviews features degrade gracefully, no errors.
- Finale burst publishes to the live WP → verify → USER blocks site from public access.

## Planted article (publish verbatim; voice fingerprint is deliberate)

The fingerprint to look for in the generated writingStyle: sailing/nautical metaphors,
very short punch sentences, direct second-person address, the recurring phrase
"Here's the thing:", small numbered lists.

**Title: Your Spine Is a Mast, Not a Coat Rack**

Most people treat their spine like a coat rack. Something to hang a body on. Load it
up, forget about it, complain when it creaks.

Here's the thing: your spine is a mast.

A mast holds the whole ship in tension. Every line, every sail, every degree of lean
runs through it. When the mast is true, the boat points where you steer. When it
warps, even a little, you fight the wheel all day and blame the weather.

Your body works the same way. The spine is not furniture. It is rigging under load,
all day, every day.

Think about your morning. You fold yourself into a car seat. You lean into a screen.
You carry a bag on the same shoulder you always use. None of it feels like much.
Neither does one loose stay on a sailboat. But small slack compounds. The lean
becomes the posture. The posture becomes the ache. The ache becomes the thing you
plan your day around.

Sailors do not wait for the mast to crack. They tune the rig. A quarter turn here.
A check of the tension there. Boring, small, regular. That is the entire secret,
and nobody wants to hear it, because boring does not sell.

Here's the thing: maintenance beats rescue. Every time.

So what does tuning look like for a body? Three habits, none of them heroic:

1. Change your position before your body demands it. If you sit, stand every half
hour. Not because sitting is evil. Because holding ANY position too long lets the
slack settle in.

2. Load both sides. Swap the bag shoulder. Alternate the arm that carries the
groceries. Symmetry is not about perfection. It is about not always leaning the
same way into the same wind.

3. Pay attention to the small creaks. A twinge that shows up three mornings in a
row is information. Not a crisis. Information. Ships log everything. Log your body.

None of this replaces getting the rig professionally checked. A trained eye catches
what you cannot feel yet, the way a rigger spots a hairline issue from the dock.
That is what an examination is for: finding the slack before it finds you.

But do not outsource the whole job. The daily tuning is yours. Nobody else stands
your watch.

People ask me why I go on about small habits when they came in asking about one
sore spot. Because the sore spot is rarely the story. It is the loudest passenger,
not the captain. The story is how the whole rig has been carrying load, for months,
usually longer.

Here's the thing: you do not need to become a different person. You need a
quarter-turn of attention, applied regularly, at the points where your day loads
your spine.

Tune the mast. Trim the sails. Watch how differently the boat handles.

Your body is the only vessel you get. Sail it like you plan to keep it.

*(~600 words)*

## Dummy voice-interview answers (paste/speak during steps Q1–Q5)

- **q_declaration** ("what do you stand for"): "I believe the body mostly knows what it
  is doing, and my job is to remove what is in its way. No drama, no miracle talk.
  Small corrections, applied consistently, change how people carry their whole day."
- **q_enemy** ("what are you against"): "I am against the quick-fix promise. The
  crack-and-bill model. Anyone who tells you one visit fixes ten years of habits is
  selling you the weather forecast, not the voyage."
- **q_tribe** ("who do you serve"): "Working families mostly. Parents who carry kids on
  one hip, desk workers, tradespeople. People who do not want a lecture, they want to
  get back to their life with less friction."
- **q_line** ("your one line"): "Maintenance beats rescue, every time."
- **q_proof** ("why believe you"): "Twenty years of practice and I still measure before
  I touch. I would rather tell someone they do not need me than invent a treatment
  plan. That is why families stay for decades."

## Post-test teardown

- [ ] USER: block the site from public access entirely (after WP publish verified).
- [ ] USER: delete any social test posts.
- [ ] ME: mark E2E result in this file; if green → merge staging → main (pre-launch).
