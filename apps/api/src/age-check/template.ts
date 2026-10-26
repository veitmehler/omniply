/**
 * The Body Resilience Score — per-studio client-facing self-check (wellness
 * vertical, the Spine Check's sibling). REWORKED 2026-10-26 from "The
 * Biological Age Check" (resilience-funnel-rework plan: bio-age angle
 * saturated in the niche; Dasha's market feedback). Hook: "How fast do you
 * bounce back?"; "full capacity" defines it (Veit's blend). Scoring KEEPS
 * the proven question deltas and pillar math; the overall result is now the
 * mean of the four pillar scores (0-100) with bands, and the calendar-age
 * question is GONE (a resilience score needs no age; less PII, one less
 * screen). The retake-in-30-days loop is the differentiator bio-age could
 * never offer.
 *
 * Two render targets, mirroring spine-check/template.ts:
 *  - buildAgeCheckFragment(): style + markup + scripts, ALL CSS scoped under
 *    #ac-app — safe inside a WordPress page (theme wraps it).
 *  - buildAgeCheckHtml(): full standalone document (hosted route + download).
 *
 * Regulatory guardrails live HERE, not in per-studio config (claims policy
 * 2026-10-20): habits-only questions, the result is framed as a LIFESTYLE
 * ESTIMATE (never a medical measurement), awareness-register verdicts, fixed
 * educational disclaimer. The scoring block is marker-delimited (AGE_MATH)
 * so tests eval exactly what ships.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Escape for embedding inside a single-quoted JS string literal. */
const jsq = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/<\//g, '<\\/')

export interface AgeCheckStudio {
  accountId: string
  practiceName: string
  logoUrl: string | null // data URI (standalone) or https URL
  headerBg: string
  buttonColor: string
  buttonTextColor: string
  accent: string
  bookingUrl: string | null
  phone: string | null // call-to-book fallback when no online booking
  captureUrl: string // absolute POST endpoint
  guideTitles: { move: string; sleep: string; unwind: string; fuel: string }
  /** false until the studio's guides are live with Drive files — the quiz
   * then makes no delivery promises (capture + booking CTA only). */
  guidesAvailable: boolean
  /** The not-quiz-matched first-visit guide (chiro quiz's firstVisitGuide
   * mirror): shown as a one-line extra when live, null otherwise. */
  firstVisitGuideTitle: string | null
}

export function buildAgeCheckFragment(c: AgeCheckStudio): string {
  const name = esc(c.practiceName)
  return `<style>
  #ac-app { --btn: ${c.buttonColor}; --btnText: ${c.buttonTextColor}; --headerBg: ${c.headerBg}; --accent: ${c.accent}; --ink: #1d2530; --dim: #5c6672; --line: #e3e6ea; --card: #ffffff; }
  #ac-app, #ac-app * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  #ac-app { display: block; max-width: 560px; margin: 0 auto; padding: 0 18px 48px; color: var(--ink); line-height: 1.55; }
  #ac-app .ac-brand { background: var(--headerBg); border-radius: 0 0 16px 16px; padding: 26px 20px 22px; text-align: center; margin-bottom: 26px; }
  #ac-app .ac-brand img { max-height: 56px; max-width: 65%; height: auto; }
  #ac-app .ac-brand .ac-nm { color: #ffffff; font-size: 20px; font-weight: 700; }
  #ac-app .ac-screen { display: none; }
  #ac-app .ac-screen.ac-active { display: block; }
  #ac-app h1 { font-size: 27px; line-height: 1.2; margin-bottom: 12px; }
  #ac-app h2 { font-size: 21px; line-height: 1.3; margin-bottom: 6px; }
  #ac-app .ac-sub { color: var(--dim); font-size: 16px; margin-bottom: 20px; }
  #ac-app .ac-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 20px; }
  #ac-app .ac-btn { display: block; width: 100%; background: var(--btn); color: var(--btnText); border: none; border-radius: 10px; cursor: pointer; text-align: center; text-decoration: none; font-size: 17px; font-weight: 700; padding: 15px 20px; }
  #ac-app .ac-qmeta { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
  #ac-app .ac-progress { height: 5px; background: var(--line); border-radius: 3px; margin: 4px 0 16px; overflow: hidden; }
  #ac-app .ac-progress i { display: block; height: 100%; background: var(--btn); width: 0%; transition: width 0.3s ease; border-radius: 3px; }
  #ac-app .ac-answers { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
  #ac-app .ac-answers button { text-align: left; background: var(--card); border: 1.5px solid var(--line); border-radius: 10px; cursor: pointer; font-size: 16px; color: var(--ink); padding: 14px 16px; min-height: 52px; width: 100%; }
  #ac-app .ac-answers button.ac-sel { border-color: var(--btn); box-shadow: inset 0 0 0 1px var(--btn); }
  #ac-app .ac-back { background: none; border: none; color: var(--dim); font-size: 14px; cursor: pointer; margin-top: 16px; padding: 6px 0; }
  #ac-app .ac-gate input, #ac-app .ac-agein { width: 100%; background: var(--card); border: 1.5px solid var(--line); border-radius: 10px; font-size: 16px; color: var(--ink); padding: 14px 16px; margin-bottom: 12px; }
  #ac-app .ac-err { color: #b3423a; font-size: 14px; margin: -6px 0 10px; display: none; }
  #ac-app .ac-fine { font-size: 12.5px; color: var(--dim); margin-top: 10px; }
  #ac-app .ac-scorehead { text-align: center; margin-bottom: 18px; }
  #ac-app .ac-scorenum { font-size: 52px; font-weight: 800; line-height: 1; }
  #ac-app .ac-scorenum small { font-size: 18px; color: var(--dim); font-weight: 500; }
  #ac-app .ac-delta { font-size: 16px; margin-top: 10px; }
  #ac-app .ac-bars { display: flex; flex-direction: column; gap: 12px; margin: 4px 0 14px; }
  #ac-app .ac-bar .ac-r1 { display: flex; justify-content: space-between; font-size: 14.5px; margin-bottom: 5px; }
  #ac-app .ac-bar .ac-v { color: var(--dim); }
  #ac-app .ac-bar .ac-track { height: 7px; background: var(--line); border-radius: 4px; overflow: hidden; }
  #ac-app .ac-bar .ac-fill { height: 100%; background: var(--btn); border-radius: 4px; }
  #ac-app .ac-bar.ac-weak .ac-r1 b { color: var(--accent); }
  #ac-app .ac-verdict { border-left: 3px solid var(--accent); padding: 4px 0 4px 14px; margin: 16px 0; font-size: 15.5px; }
  #ac-app .ac-guidebox { border: 1px solid var(--line); border-left: 4px solid var(--btn); border-radius: 12px; padding: 16px 18px; margin: 16px 0 0; font-size: 15.5px; }
  #ac-app .ac-disclaimer { font-size: 12.5px; color: var(--dim); margin-top: 18px; }
  #ac-app .ac-credit { text-align: center; color: var(--accent); font-size: 13px; padding-top: 18px; }
  /* Embedded context (iframe on the studio's own site): same treatment the
     spine check earned in the 2026-09-14 live WP review. */
  #ac-app.ac-embedded .ac-brand, #ac-app.ac-embedded .ac-credit { display: none; }
  #ac-app.ac-embedded { background: var(--headerBg); border-radius: 18px; padding: 26px 22px 34px; }
  #ac-app.ac-embedded .ac-screen.ac-active { background: var(--card); border-radius: 14px; padding: 26px 22px; }
</style>
<div id="ac-app">
  <div class="ac-brand">
    ${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="${name}" />` : `<div class="ac-nm">${name}</div>`}
  </div>

  <div class="ac-screen ac-active" id="ac-intro">
    <div class="ac-qmeta">The Body Resilience Score</div>
    <h1>How fast do you bounce back?</h1>
    <p class="ac-sub">After a hard session, a rough night, a long flight, a heavy week: some bodies are back to full capacity by morning and some drag for days. Twelve quick questions about how you move, sleep, switch off and fuel up. Two minutes, no wearable needed${c.guidesAvailable ? ', and a free guide picked for your result' : ''}.</p>
    <button class="ac-btn" id="ac-start" type="button">Get my Score</button>
    <p class="ac-fine">Free · from ${name} · nothing to install</p>
  </div>

  <div class="ac-screen" id="ac-q">
    <div class="ac-qmeta" id="ac-qmeta"></div>
    <div class="ac-progress"><i id="ac-pbar"></i></div>
    <div id="ac-qbody"></div>
    <button class="ac-back" id="ac-qback" type="button">&larr; Back</button>
  </div>

  <div class="ac-screen ac-gate" id="ac-gate">
    <h2>Your Score is ready.</h2>
    <p class="ac-sub">Where should we send your Body Resilience Score${c.guidesAvailable ? ' and your free guide' : ''}?</p>
    <input type="text" id="ac-f-name" placeholder="First name" autocomplete="given-name" />
    <input type="email" id="ac-f-email" placeholder="Email" autocomplete="email" />
    <div class="ac-err" id="ac-err">Please enter your name and a valid email.</div>
    <input type="tel" id="ac-f-phone" placeholder="Mobile (optional)" autocomplete="tel" />
    <button class="ac-btn" id="ac-reveal" type="button">Show my result</button>
    <p class="ac-fine">We'll email your result, and you'll receive ${name}'s wellness letter and occasional offers. Unsubscribe anytime.</p>
  </div>

  <div class="ac-screen" id="ac-results">
    <div class="ac-scorehead">
      <div class="ac-qmeta">Your Body Resilience Score</div>
      <div class="ac-scorenum"><span id="ac-total">0</span><small> / 100</small></div>
      <div class="ac-delta" id="ac-delta"></div>
      <p class="ac-fine" style="margin-top:8px;">Your score estimates how quickly you return to full capacity after life takes a swing at you.</p>
    </div>
    <div class="ac-card">
      <div class="ac-qmeta">Your four bounce-back inputs</div>
      <div class="ac-bars" id="ac-bars"></div>
      <div class="ac-verdict" id="ac-verdict"></div>
      <div class="ac-guidebox" id="ac-guidebox"></div>
    </div>
    ${c.bookingUrl ? `<div style="margin-top:18px;"><a class="ac-btn" href="${esc(c.bookingUrl)}" target="_blank" rel="noopener">Book a visit with ${name}</a></div>` : c.phone ? `<div style="margin-top:18px;"><a class="ac-btn" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">Call ${name} to book</a></div>` : ''}
    <p class="ac-fine" style="margin-top:14px;">Habits move fast. Retake the check in 30 days and watch your score respond.</p>
    <p class="ac-disclaimer">This is an educational estimate built from your lifestyle answers... a habit-based picture of how well your routines support bounce-back, not a medical measurement, assessment or diagnosis. What this check shows is which everyday habits are likely helping or costing you, and where to start. If something has been bothering you, a qualified professional is always the right next step.</p>
  </div>

  <div class="ac-credit">${name}</div>
</div>

<script>
(function () {
  try {
    var embedded = /[?&]embed=1/.test(window.location.search) || window.parent !== window
    if (embedded) document.getElementById('ac-app').className = 'ac-embedded'
  } catch (e) { /* standalone look is the safe default */ }
})()
</script>
<script>
/*__AGE_MATH_START__*/
var AGECHECK = (function () {
  'use strict'
  // Habit questions ONLY — no symptoms, no pain scales, no conditions
  // (claims policy 2026-10-20). Each option carries a YEAR delta: negative
  // keeps you younger, positive adds years. Deltas are the quiz's whole
  // scoring model — change them only with a matching test update.
  var QUESTIONS = [
    { p: 'move', label: 'How you move', text: 'On a normal day, how much do you actually move?',
      opts: [["I'm on my feet or walking much of the day", -1], ['A walk or workout most days', -0.5], ['Desk-bound, but I move when I can', 0.75], ['Mostly sitting, door to door', 1.5]] },
    { p: 'move', label: 'How you move', text: 'How often do you do something that strengthens your muscles?',
      opts: [['Twice a week or more', -1], ['About once a week', -0.25], ['Now and then', 0.75], ['Rarely or never', 1.5]] },
    { p: 'move', label: 'How you move', text: 'Stretching or mobility work happens...',
      opts: [['Most days', -1], ['A few times a week', -0.5], ['Occasionally', 0.5], ['Basically never', 1.25]] },
    { p: 'sleep', label: 'How you sleep', text: 'Most nights you sleep...',
      opts: [['7 to 8 hours', -1], ['More than 8', -0.25], ['6 to 7', 0.5], ['Under 6', 1.5]] },
    { p: 'sleep', label: 'How you sleep', text: 'Your bed and wake times are...',
      opts: [['Steady, even on weekends', -1], ['Fairly regular', -0.25], ['All over the place', 1], ['Shift work or long-haul life', 1.25]] },
    { p: 'sleep', label: 'How you sleep', text: 'How do you usually wake up?',
      opts: [['Rested, often before the alarm', -1], ['Fine after a coffee', 0], ['Groggy for a while', 0.75], ['Exhausted, snooze on repeat', 1.5]] },
    { p: 'unwind', label: 'How you unwind', text: 'Stress in a typical week feels...',
      opts: [['Low... more good days than hard ones', -1], ['Manageable', -0.25], ['High, but I cope', 0.75], ['Running on fumes', 1.5]] },
    { p: 'unwind', label: 'How you unwind', text: 'Real downtime... no screens, no obligations... happens:',
      opts: [['A little every day', -1], ['A few times a week', -0.25], ['Some weekends', 0.75], ["What's downtime?", 1.5]] },
    { p: 'unwind', label: 'How you unwind', text: 'The hour before bed usually looks like...',
      opts: [['Winding down... reading, stretching, quiet', -1], ['TV or a show', 0], ['Scrolling in bed', 0.75], ['Working or worrying', 1.25]] },
    { p: 'fuel', label: 'How you fuel', text: 'Vegetables and whole foods land on your plate...',
      opts: [['At most meals', -1], ['About once a day', -0.25], ['A few times a week', 0.75], ['Not often', 1.5]] },
    { p: 'fuel', label: 'How you fuel', text: 'Alcohol in a typical week...',
      opts: [['None or almost none', -1], ['A couple of drinks', 0], ['Most evenings', 1], ["More than I'd like", 1.5]] },
    { p: 'fuel', label: 'How you fuel', text: 'Do you smoke or vape?',
      opts: [['Never have', -1], ['Quit years ago', -0.25], ['Quit recently', 0.5], ['Yes', 2]] },
  ]

  var PILLARS = ['move', 'sleep', 'unwind', 'fuel'] // tiebreak: most trainable first
  var PILLAR_LABEL = { move: 'Movement & strength', sleep: 'Sleep', unwind: 'Stress & downtime', fuel: 'Everyday fuel' }
  // Aspirational bands (resilience rework 2026-10-26): the low end never
  // shames. Thresholds 55 / 70 / 85.
  var BANDS = [
    { min: 85, name: 'Elite' },
    { min: 70, name: 'Strong' },
    { min: 55, name: 'Solid' },
    { min: 0, name: 'Developing' },
  ]

  function bandFor (score) {
    for (var i = 0; i < BANDS.length; i++) {
      if (score >= BANDS[i].min) return BANDS[i].name
    }
    return 'Developing'
  }

  function compute (answers) {
    var sums = { move: 0, sleep: 0, unwind: 0, fuel: 0 }
    var min = { move: 0, sleep: 0, unwind: 0, fuel: 0 }
    var max = { move: 0, sleep: 0, unwind: 0, fuel: 0 }
    for (var i = 0; i < QUESTIONS.length; i++) {
      var q = QUESTIONS[i]
      var lo = q.opts[0][1]
      var hi = q.opts[0][1]
      for (var j = 0; j < q.opts.length; j++) {
        if (q.opts[j][1] < lo) lo = q.opts[j][1]
        if (q.opts[j][1] > hi) hi = q.opts[j][1]
      }
      min[q.p] += lo
      max[q.p] += hi
      sums[q.p] += (typeof answers[i] === 'number' ? answers[i] : 0)
    }
    var scores = {}
    var total = 0
    for (var k = 0; k < PILLARS.length; k++) {
      var p = PILLARS[k]
      // Pillar score for the bars: 100 = best possible habits, 0 = worst.
      scores[p] = Math.round(((max[p] - sums[p]) / (max[p] - min[p])) * 100)
      total += scores[p]
    }
    // The Body Resilience Score: the mean of the four input scores.
    var score = Math.round(total / PILLARS.length)
    if (score < 0) score = 0
    if (score > 100) score = 100
    var weakest = PILLARS[0]
    for (var m = 0; m < PILLARS.length; m++) {
      if (scores[PILLARS[m]] < scores[weakest]) weakest = PILLARS[m]
    }
    return { score: score, band: bandFor(score), scores: scores, weakest: weakest }
  }

  return { QUESTIONS: QUESTIONS, PILLARS: PILLARS, PILLAR_LABEL: PILLAR_LABEL, BANDS: BANDS, bandFor: bandFor, compute: compute }
})()
if (typeof module !== 'undefined' && module.exports) module.exports = AGECHECK
/*__AGE_MATH_END__*/
</script>

<script>
(function () {
  'use strict'
  var STUDIO = {
    accountId: '${jsq(c.accountId)}',
    captureUrl: '${jsq(c.captureUrl)}',
    guideTitles: { move: '${jsq(c.guideTitles.move)}', sleep: '${jsq(c.guideTitles.sleep)}', unwind: '${jsq(c.guideTitles.unwind)}', fuel: '${jsq(c.guideTitles.fuel)}' },
    guidesAvailable: ${c.guidesAvailable ? 'true' : 'false'},
    firstVisitGuide: ${c.firstVisitGuideTitle ? `'${jsq(c.firstVisitGuideTitle)}'` : 'null'},
  }
  // Awareness-register verdicts (same guardrail as the spine check): habits
  // language, no alarm, no promises — the input is the protagonist.
  var VERDICTS = {
    move: 'Movement and strength are the input slowing your bounce-back the most right now. The good news: this is the most responsive input there is... small, regular doses of strength and daily movement tend to pay back fastest.',
    sleep: 'Sleep is the input holding your bounce-back down. Sleep is when the body does its repair work... a steadier routine usually changes how fast everything else recovers.',
    unwind: 'Stress and missing downtime are the biggest drag on your bounce-back. Real switch-off time, built into the week on purpose, is one of the most underrated recovery tools there is.',
    fuel: 'Everyday fuel... food, drinks and what goes with them... is the input costing you the most bounce-back. Small swaps you actually keep beat any overhaul.',
  }
  // Band verdict lines (resilience rework 2026-10-26): claims-safe, no shame.
  var BAND_LINES = {
    Developing: 'Your routines are leaving bounce-back on the table. The good news: this score responds quickly to small changes.',
    Solid: 'A dependable base. One input is holding the others back, and it is probably the one you expect least.',
    Strong: 'Your body recovers well. The next gains come from precision, not more effort.',
    Elite: 'Rare air. At this level the question becomes how long you can keep it, and that is its own craft.',
  }
  function $ (id) { return document.getElementById(id) }
  var answers = []
  var idx = 0

  function reportHeight () {
    try {
      var app = $('ac-app')
      if (app && window.parent !== window) {
        window.parent.postMessage({ type: 'ac-height', height: app.scrollHeight + 48 }, '*')
      }
    } catch (e) { /* noop */ }
  }
  window.addEventListener('resize', reportHeight)
  setTimeout(reportHeight, 60)

  function show (id) {
    var scr = document.querySelectorAll('#ac-app .ac-screen')
    for (var i = 0; i < scr.length; i++) scr[i].classList.toggle('ac-active', scr[i].id === id)
    var app = $('ac-app')
    if (app && app.scrollIntoView) app.scrollIntoView({ block: 'start' })
    setTimeout(reportHeight, 60)
  }

  $('ac-start').addEventListener('click', function () {
    idx = 0
    show('ac-q')
    render()
  })
  $('ac-qback').addEventListener('click', function () {
    if (idx === 0) { show('ac-intro'); return }
    idx--; render()
  })

  function render () {
    var q = AGECHECK.QUESTIONS[idx]
    $('ac-qmeta').textContent = (idx + 1) + ' of ' + AGECHECK.QUESTIONS.length + ' · ' + q.label
    $('ac-pbar').style.width = (idx / AGECHECK.QUESTIONS.length * 100) + '%'
    var body = $('ac-qbody')
    body.innerHTML = ''
    var h = document.createElement('h2')
    h.textContent = q.text
    body.appendChild(h)
    var wrap = document.createElement('div')
    wrap.className = 'ac-answers'
    for (var i = 0; i < q.opts.length; i++) {
      (function (opt) {
        var b = document.createElement('button')
        b.type = 'button'
        b.textContent = opt[0]
        if (answers[idx] === opt[1]) b.className = 'ac-sel'
        b.addEventListener('click', function () {
          answers[idx] = opt[1]
          b.className = 'ac-sel'
          setTimeout(function () {
            if (idx < AGECHECK.QUESTIONS.length - 1) { idx++; render(); reportHeight() } else { $('ac-pbar').style.width = '100%'; show('ac-gate'); $('ac-f-name').focus() }
          }, 160)
        })
        wrap.appendChild(b)
      })(q.opts[i])
    }
    body.appendChild(wrap)
  }

  $('ac-reveal').addEventListener('click', function () {
    var name = $('ac-f-name').value.trim()
    var email = $('ac-f-email').value.trim()
    var ok = name && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)
    $('ac-err').style.display = ok ? 'none' : 'block'
    if (!ok) return
    var r = AGECHECK.compute(answers)
    sendCapture(name, email, $('ac-f-phone').value.trim(), r)
    renderResults(r)
    show('ac-results')
  })

  function sendCapture (name, email, phone, r, attempt) {
    try {
      fetch(STUDIO.captureUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: STUDIO.accountId,
          name: name, email: email, phone: phone || null,
          score: r.score, band: r.band,
          scores: r.scores, weakestPillar: r.weakest,
          source: 'age-check',
        }),
        keepalive: true,
      }).catch(function () { if (!attempt) setTimeout(function () { sendCapture(name, email, phone, r, 1) }, 2500) })
    } catch (e) { /* results always show */ }
  }

  function renderResults (r) {
    $('ac-total').textContent = r.score
    $('ac-delta').innerHTML = '<b>That is ' + r.band + '.</b> ' + BAND_LINES[r.band]
    var bars = $('ac-bars')
    bars.innerHTML = ''
    for (var i = 0; i < AGECHECK.PILLARS.length; i++) {
      var p = AGECHECK.PILLARS[i]
      var div = document.createElement('div')
      div.className = 'ac-bar' + (p === r.weakest ? ' ac-weak' : '')
      div.innerHTML = '<div class="ac-r1"><b>' + AGECHECK.PILLAR_LABEL[p] + '</b><span class="ac-v">' + r.scores[p] + '/100</span></div>' +
        '<div class="ac-track"><div class="ac-fill" style="width:' + r.scores[p] + '%"></div></div>'
      bars.appendChild(div)
    }
    $('ac-verdict').textContent = VERDICTS[r.weakest]
    var g
    if (STUDIO.guidesAvailable) {
      g = '<b>Your free guide is on its way:</b> "' + STUDIO.guideTitles[r.weakest] + '" ... check your inbox in the next few minutes.'
      if (STUDIO.firstVisitGuide) {
        g += '<br /><span style="color:#5c6672; font-size:14px;">Never been to a recovery studio before? Keep an eye out for "' + STUDIO.firstVisitGuide + '" too.</span>'
      }
    } else {
      g = "<b>Thanks... you're on the list.</b> Want to start working on your weakest input this week? Booking a visit is the simplest next step."
    }
    $('ac-guidebox').innerHTML = g
  }
})()
</script>`
}

/** Full standalone document (hosted route + Settings download). */
export function buildAgeCheckHtml(c: AgeCheckStudio): string {
  const name = esc(c.practiceName)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The Body Resilience Score — ${name}</title>
<meta name="description" content="How fast do you bounce back? Twelve quick questions about how you move, sleep, switch off and fuel up — your Body Resilience Score in two minutes, from ${name}." />
</head>
<body style="margin:0;background:#f7f8fa;">
${buildAgeCheckFragment(c)}
</body>
</html>`
}
