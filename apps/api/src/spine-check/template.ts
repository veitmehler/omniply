/**
 * The 2-Minute Spine Check — per-clinic patient-facing self-check
 * (spine-check plan). Generated per clinic with their brand tokens.
 *
 * Two render targets:
 *  - buildSpineCheckFragment(): style + markup + scripts, ALL CSS scoped under
 *    #sc-app — safe to publish INSIDE a WordPress page (theme wraps it).
 *  - buildSpineCheckHtml(): full standalone document (hosted route + download).
 *
 * Regulatory guardrails live HERE, not in per-clinic config: habits-only
 * questions, awareness verdicts, fixed educational disclaimer.
 * The scoring block is marker-delimited (SPINE_MATH) so tests eval exactly
 * what ships.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Escape for embedding inside a single-quoted JS string literal. */
const jsq = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/<\//g, '<\\/')

export interface SpineCheckClinic {
  accountId: string
  practiceName: string
  logoUrl: string | null // data URI (standalone) or https URL
  headerBg: string
  buttonColor: string
  buttonTextColor: string
  accent: string
  bookingUrl: string | null
  phone: string | null // call-to-book fallback when no online booking (run-3 item 8)
  captureUrl: string // absolute POST endpoint
  guideTitles: { desk: string; sleep: string; morning: string; niggle: string }
  firstVisitGuideTitle: string | null
  /** false until the clinic's guides are live with Drive files — the quiz
   * then makes no delivery promises (capture + booking CTA only). */
  guidesAvailable: boolean
}

export function buildSpineCheckFragment(c: SpineCheckClinic): string {
  const name = esc(c.practiceName)
  return `<style>
  #sc-app { --btn: ${c.buttonColor}; --btnText: ${c.buttonTextColor}; --headerBg: ${c.headerBg}; --accent: ${c.accent}; --ink: #1d2530; --dim: #5c6672; --line: #e3e6ea; --card: #ffffff; }
  #sc-app, #sc-app * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  #sc-app { display: block; max-width: 560px; margin: 0 auto; padding: 0 18px 48px; color: var(--ink); line-height: 1.55; }
  #sc-app .sc-brand { background: var(--headerBg); border-radius: 0 0 16px 16px; padding: 26px 20px 22px; text-align: center; margin-bottom: 26px; }
  #sc-app .sc-brand img { max-height: 56px; max-width: 65%; height: auto; }
  #sc-app .sc-brand .sc-nm { color: #ffffff; font-size: 20px; font-weight: 700; }
  #sc-app .sc-screen { display: none; }
  #sc-app .sc-screen.sc-active { display: block; }
  #sc-app h1 { font-size: 27px; line-height: 1.2; margin-bottom: 12px; }
  #sc-app h2 { font-size: 21px; line-height: 1.3; margin-bottom: 6px; }
  #sc-app .sc-sub { color: var(--dim); font-size: 16px; margin-bottom: 20px; }
  #sc-app .sc-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 20px; }
  #sc-app .sc-btn { display: block; width: 100%; background: var(--btn); color: var(--btnText); border: none; border-radius: 10px; cursor: pointer; text-align: center; text-decoration: none; font-size: 17px; font-weight: 700; padding: 15px 20px; }
  #sc-app .sc-qmeta { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
  #sc-app .sc-progress { height: 5px; background: var(--line); border-radius: 3px; margin: 4px 0 16px; overflow: hidden; }
  #sc-app .sc-progress i { display: block; height: 100%; background: var(--btn); width: 0%; transition: width 0.3s ease; border-radius: 3px; }
  #sc-app .sc-answers { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
  #sc-app .sc-answers button { text-align: left; background: var(--card); border: 1.5px solid var(--line); border-radius: 10px; cursor: pointer; font-size: 16px; color: var(--ink); padding: 14px 16px; min-height: 52px; width: 100%; }
  #sc-app .sc-answers button.sc-sel { border-color: var(--btn); box-shadow: inset 0 0 0 1px var(--btn); }
  #sc-app .sc-back { background: none; border: none; color: var(--dim); font-size: 14px; cursor: pointer; margin-top: 16px; padding: 6px 0; }
  #sc-app .sc-gate input { width: 100%; background: var(--card); border: 1.5px solid var(--line); border-radius: 10px; font-size: 16px; color: var(--ink); padding: 14px 16px; margin-bottom: 12px; }
  #sc-app .sc-err { color: #b3423a; font-size: 14px; margin: -6px 0 10px; display: none; }
  #sc-app .sc-fine { font-size: 12.5px; color: var(--dim); margin-top: 10px; }
  #sc-app .sc-scorehead { text-align: center; margin-bottom: 18px; }
  #sc-app .sc-scorenum { font-size: 52px; font-weight: 800; line-height: 1; }
  #sc-app .sc-scorenum small { font-size: 18px; color: var(--dim); font-weight: 500; }
  #sc-app .sc-bars { display: flex; flex-direction: column; gap: 12px; margin: 4px 0 14px; }
  #sc-app .sc-bar .sc-r1 { display: flex; justify-content: space-between; font-size: 14.5px; margin-bottom: 5px; }
  #sc-app .sc-bar .sc-v { color: var(--dim); }
  #sc-app .sc-bar .sc-track { height: 7px; background: var(--line); border-radius: 4px; overflow: hidden; }
  #sc-app .sc-bar .sc-fill { height: 100%; background: var(--btn); border-radius: 4px; }
  #sc-app .sc-bar.sc-weak .sc-r1 b { color: var(--accent); }
  #sc-app .sc-verdict { border-left: 3px solid var(--accent); padding: 4px 0 4px 14px; margin: 16px 0; font-size: 15.5px; }
  #sc-app .sc-guidebox { border: 1px solid var(--line); border-left: 4px solid var(--btn); border-radius: 12px; padding: 16px 18px; margin: 16px 0 0; font-size: 15.5px; }
  #sc-app .sc-disclaimer { font-size: 12.5px; color: var(--dim); margin-top: 18px; }
  #sc-app .sc-credit { text-align: center; color: var(--accent); font-size: 13px; padding-top: 18px; }
  /* Embedded context (iframe on the clinic's own site): their page header
     already carries the brand — drop the redundant strip + credit. Instead,
     the whole quiz sits as a white card on a brand-color backdrop so it pops
     off the host page, with real breathing room at the top (both were Veit
     feedback from the 2026-09-14 live WP review). */
  #sc-app.sc-embedded .sc-brand, #sc-app.sc-embedded .sc-credit { display: none; }
  #sc-app.sc-embedded { background: var(--headerBg); border-radius: 18px; padding: 26px 22px 34px; }
  #sc-app.sc-embedded .sc-screen.sc-active { background: var(--card); border-radius: 14px; padding: 26px 22px; }
</style>
<div id="sc-app">
  <div class="sc-brand">
    ${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="${name}" />` : `<div class="sc-nm">${name}</div>`}
  </div>

  <div class="sc-screen sc-active" id="sc-intro">
    <h1>The 2-Minute Spine Check</h1>
    <p class="sc-sub">A quick, friendly look at your daily back habits... your desk, your sleep, your mornings. Twelve taps, two minutes, no jargon. At the end you'll get your Spine Habits Score${c.guidesAvailable ? ' and a free guide picked for you' : ''}.</p>
    <button class="sc-btn" id="sc-start" type="button">Start my Spine Check</button>
    <p class="sc-fine">Free · from ${name} · nothing to install</p>
  </div>

  <div class="sc-screen" id="sc-q">
    <div class="sc-qmeta" id="sc-qmeta"></div>
    <div class="sc-progress"><i id="sc-pbar"></i></div>
    <div id="sc-qbody"></div>
    <button class="sc-back" id="sc-qback" type="button">&larr; Back</button>
  </div>

  <div class="sc-screen sc-gate" id="sc-gate">
    <h2>Your results are ready.</h2>
    <p class="sc-sub">Where should we send your Spine Check results${c.guidesAvailable ? ' and your free guide' : ''}?</p>
    <input type="text" id="sc-f-name" placeholder="First name" autocomplete="given-name" />
    <input type="email" id="sc-f-email" placeholder="Email" autocomplete="email" />
    <div class="sc-err" id="sc-err">Please enter your name and a valid email.</div>
    <input type="tel" id="sc-f-phone" placeholder="Mobile (optional)" autocomplete="tel" />
    <button class="sc-btn" id="sc-reveal" type="button">Show my results</button>
    <p class="sc-fine">We'll email your guide, and you'll receive ${name}'s monthly health letter and occasional offers. Unsubscribe anytime.</p>
  </div>

  <div class="sc-screen" id="sc-results">
    <div class="sc-scorehead">
      <div class="sc-qmeta">Your Spine Habits Score</div>
      <div class="sc-scorenum"><span id="sc-total">0</span><small> / 100</small></div>
    </div>
    <div class="sc-card">
      <div class="sc-bars" id="sc-bars"></div>
      <div class="sc-verdict" id="sc-verdict"></div>
      <div class="sc-guidebox" id="sc-guidebox"></div>
    </div>
    ${c.bookingUrl ? `<div style="margin-top:18px;"><a class="sc-btn" href="${esc(c.bookingUrl)}" target="_blank" rel="noopener">Book a visit with ${name}</a></div>` : c.phone ? `<div style="margin-top:18px;"><a class="sc-btn" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">Call ${name} to book</a></div>` : ''}
    <p class="sc-disclaimer">This is an educational self-check of your daily habits... not a medical assessment or diagnosis. If something has been bothering you, a professional look is always the safest next step.</p>
  </div>

  <div class="sc-credit">${name}</div>
</div>

<script>
(function () {
  try {
    var embedded = /[?&]embed=1/.test(window.location.search) || window.parent !== window
    if (embedded) document.getElementById('sc-app').className = 'sc-embedded'
  } catch (e) { /* standalone look is the safe default */ }
})()
</script>
<script>
/*__SPINE_MATH_START__*/
var SPINE = (function () {
  'use strict'
  // Habit questions ONLY — no symptom scoring, no pain scales (guardrail #1).
  var QUESTIONS = [
    { d: 'desk', label: 'Your desk', text: 'How many hours a day do you sit for work?',
      opts: [['Under 2', 10], ['2 to 5', 7], ['5 to 8', 3], ['More than 8', 0]] },
    { d: 'desk', label: 'Your desk', text: 'Your screen sits...',
      opts: [['At eye level', 10], ['A bit low', 7], ["It's a laptop on a desk", 3], ['I work from the couch', 0]] },
    { d: 'desk', label: 'Your desk', text: 'How often do you stand up and move during work?',
      opts: [['Every 30 minutes or so', 10], ['About hourly', 7], ['When I remember', 3], ['Rarely', 0]] },
    { d: 'sleep', label: 'Your sleep', text: 'You mostly sleep...',
      opts: [['On your back', 10], ['On your side', 7], ['It changes all night', 3], ['On your stomach', 0]] },
    { d: 'sleep', label: 'Your sleep', text: 'Your pillow is...',
      opts: [['Chosen for how you sleep', 10], ['Fine, I guess', 7], ['Years old', 3], ['Whatever was on sale', 0]] },
    { d: 'sleep', label: 'Your sleep', text: 'How do you feel when you wake up?',
      opts: [['Rested and loose', 10], ['A little stiff... passes fast', 7], ['Stiff for a while', 3], ['Mornings are the hardest part', 0]] },
    { d: 'morning', label: 'Your mornings', text: 'First thing after waking, you usually...',
      opts: [['Stretch or move gently', 10], ['Straight to the phone', 3], ['Straight to sitting... coffee, car, desk', 3], ['Rush out the door', 0]] },
    { d: 'morning', label: 'Your mornings', text: 'Do you do anything regularly for your back?',
      opts: [['A daily habit', 10], ['A few times a week', 7], ['When it complains', 3], ['Not really', 0]] },
    { d: 'morning', label: 'Your mornings', text: 'How do you pick things up off the floor?',
      opts: [["Bend the knees... it's automatic", 10], ['Depends on the day', 7], ['Bend at the waist', 3], ['I avoid picking things up', 0]] },
    { d: 'niggle', label: 'When it niggles', text: 'When your back grumbles, your usual move is...',
      opts: [['Get it looked at early', 10], ['Stretch and wait', 7], ['Painkillers and push through', 3], ['Ignore it until it stops', 0]] },
    { d: 'niggle', label: 'When it niggles', text: 'How long do you typically wait before doing something about it?',
      opts: [['Days', 10], ['Weeks', 7], ['Months', 3], ["Until I can't", 0]] },
    { d: 'niggle', label: 'When it niggles', text: 'Do you know what your niggles usually mean?',
      opts: [["Yes... I've had it explained", 10], ['Roughly', 7], ['Not really', 3], ['Never thought about it', 0]] },
  ]

  var DOMAINS = ['desk', 'sleep', 'morning', 'niggle'] // tiebreak: most actionable first
  var DOMAIN_LABEL = { desk: 'Desk habits', sleep: 'Sleep setup', morning: 'Morning habits', niggle: 'Listening to your back' }

  function compute (answers) {
    var sums = { desk: 0, sleep: 0, morning: 0, niggle: 0 }
    var max = { desk: 0, sleep: 0, morning: 0, niggle: 0 }
    for (var i = 0; i < QUESTIONS.length; i++) {
      var q = QUESTIONS[i]
      var best = 0
      for (var j = 0; j < q.opts.length; j++) if (q.opts[j][1] > best) best = q.opts[j][1]
      max[q.d] += best
      sums[q.d] += (answers[i] || 0)
    }
    var scores = {}
    var total = 0
    for (var k = 0; k < DOMAINS.length; k++) {
      var d = DOMAINS[k]
      scores[d] = Math.round((sums[d] / max[d]) * 100)
      total += scores[d]
    }
    var weakest = DOMAINS[0]
    for (var m = 0; m < DOMAINS.length; m++) {
      if (scores[DOMAINS[m]] < scores[weakest]) weakest = DOMAINS[m]
    }
    return { scores: scores, total: Math.round(total / DOMAINS.length), weakest: weakest }
  }

  return { QUESTIONS: QUESTIONS, DOMAINS: DOMAINS, DOMAIN_LABEL: DOMAIN_LABEL, compute: compute }
})()
if (typeof module !== 'undefined' && module.exports) module.exports = SPINE
/*__SPINE_MATH_END__*/
</script>

<script>
(function () {
  'use strict'
  var CLINIC = {
    accountId: '${jsq(c.accountId)}',
    captureUrl: '${jsq(c.captureUrl)}',
    guideTitles: { desk: '${jsq(c.guideTitles.desk)}', sleep: '${jsq(c.guideTitles.sleep)}', morning: '${jsq(c.guideTitles.morning)}', niggle: '${jsq(c.guideTitles.niggle)}' },
    firstVisitGuide: ${c.firstVisitGuideTitle ? `'${jsq(c.firstVisitGuideTitle)}'` : 'null'},
    guidesAvailable: ${c.guidesAvailable ? 'true' : 'false'},
  }
  // Awareness-register verdicts (guardrail #3): habits language, no alarm.
  var VERDICTS = {
    desk: 'Your desk habits are the ones doing your back the fewest favors right now. Small changes there tend to pay off fastest... your guide has the easy ones.',
    sleep: 'Your sleep setup looks like the place to start. A third of your life happens there... a few small adjustments usually make mornings feel very different.',
    morning: 'Your mornings are where a little routine would go a long way. The first twenty minutes of the day set the tone for your back... your guide shows the gentle version.',
    niggle: "The check suggests your back doesn't always get listened to early. Knowing what's routine and what's worth a professional look is half the battle... your guide walks you through it.",
  }
  function $ (id) { return document.getElementById(id) }
  var answers = []
  var idx = 0

  // Iframe embeds auto-size via postMessage (parent resizer in the embed
  // snippet); harmless when the quiz runs standalone.
  function reportHeight () {
    try {
      var app = $('sc-app')
      if (app && window.parent !== window) {
        window.parent.postMessage({ type: 'sc-height', height: app.scrollHeight + 48 }, '*')
      }
    } catch (e) { /* noop */ }
  }
  window.addEventListener('resize', reportHeight)
  setTimeout(reportHeight, 60)

  function show (id) {
    var scr = document.querySelectorAll('#sc-app .sc-screen')
    for (var i = 0; i < scr.length; i++) scr[i].classList.toggle('sc-active', scr[i].id === id)
    var app = $('sc-app')
    if (app && app.scrollIntoView) app.scrollIntoView({ block: 'start' })
    setTimeout(reportHeight, 60)
  }

  $('sc-start').addEventListener('click', function () { idx = 0; show('sc-q'); render() })
  $('sc-qback').addEventListener('click', function () {
    if (idx === 0) { show('sc-intro'); return }
    idx--; render()
  })

  function render () {
    var q = SPINE.QUESTIONS[idx]
    $('sc-qmeta').textContent = (idx + 1) + ' of ' + SPINE.QUESTIONS.length + ' · ' + q.label
    $('sc-pbar').style.width = (idx / SPINE.QUESTIONS.length * 100) + '%'
    var body = $('sc-qbody')
    body.innerHTML = ''
    var h = document.createElement('h2')
    h.textContent = q.text
    body.appendChild(h)
    var wrap = document.createElement('div')
    wrap.className = 'sc-answers'
    for (var i = 0; i < q.opts.length; i++) {
      (function (opt) {
        var b = document.createElement('button')
        b.type = 'button'
        b.textContent = opt[0]
        if (answers[idx] === opt[1]) b.className = 'sc-sel'
        b.addEventListener('click', function () {
          answers[idx] = opt[1]
          b.className = 'sc-sel'
          setTimeout(function () {
            if (idx < SPINE.QUESTIONS.length - 1) { idx++; render(); reportHeight() } else { $('sc-pbar').style.width = '100%'; show('sc-gate'); $('sc-f-name').focus() }
          }, 160)
        })
        wrap.appendChild(b)
      })(q.opts[i])
    }
    body.appendChild(wrap)
  }

  $('sc-reveal').addEventListener('click', function () {
    var name = $('sc-f-name').value.trim()
    var email = $('sc-f-email').value.trim()
    var ok = name && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)
    $('sc-err').style.display = ok ? 'none' : 'block'
    if (!ok) return
    var r = SPINE.compute(answers)
    sendCapture(name, email, $('sc-f-phone').value.trim(), r)
    renderResults(r)
    show('sc-results')
  })

  function sendCapture (name, email, phone, r, attempt) {
    try {
      fetch(CLINIC.captureUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: CLINIC.accountId,
          name: name, email: email, phone: phone || null,
          scores: r.scores, total: r.total, weakestDomain: r.weakest,
          source: 'spine-check',
        }),
        keepalive: true,
      }).catch(function () { if (!attempt) setTimeout(function () { sendCapture(name, email, phone, r, 1) }, 2500) })
    } catch (e) { /* results always show */ }
  }

  function renderResults (r) {
    $('sc-total').textContent = r.total
    var bars = $('sc-bars')
    bars.innerHTML = ''
    for (var i = 0; i < SPINE.DOMAINS.length; i++) {
      var d = SPINE.DOMAINS[i]
      var div = document.createElement('div')
      div.className = 'sc-bar' + (d === r.weakest ? ' sc-weak' : '')
      div.innerHTML = '<div class="sc-r1"><b>' + SPINE.DOMAIN_LABEL[d] + '</b><span class="sc-v">' + r.scores[d] + '/100</span></div>' +
        '<div class="sc-track"><div class="sc-fill" style="width:' + r.scores[d] + '%"></div></div>'
      bars.appendChild(div)
    }
    $('sc-verdict').textContent = VERDICTS[r.weakest]
    var g
    if (CLINIC.guidesAvailable) {
      g = '<b>Your free guide is on its way:</b> "' + CLINIC.guideTitles[r.weakest] + '" ... check your inbox in the next few minutes.'
      if (CLINIC.firstVisitGuide) {
        g += '<br /><span style="color:#5c6672; font-size:14px;">Never seen a chiropractor before? Keep an eye out for "' + CLINIC.firstVisitGuide + '" too.</span>'
      }
    } else {
      g = "<b>Thanks... you're on the list.</b> Want to do something about it today? Booking a visit is the simplest next step."
    }
    $('sc-guidebox').innerHTML = g
  }
})()
</script>`
}

/** Full standalone document (hosted route + Settings download). */
export function buildSpineCheckHtml(c: SpineCheckClinic): string {
  const name = esc(c.practiceName)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The 2-Minute Spine Check — ${name}</title>
<meta name="description" content="A quick, friendly look at your daily back habits — desk, sleep, mornings. Two minutes, no jargon, from ${name}." />
</head>
<body style="margin:0;background:#f7f8fa;">
${buildSpineCheckFragment(c)}
</body>
</html>`
}
