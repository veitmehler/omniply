/**
 * Personalized X-Ray Debrief — print HTML template (14 Letter pages).
 *
 * Derived from the static .documentation/marketing/xray-debrief-print.html
 * (13 pages) + a personalized "Your X-Ray Results" page 2, personalized cover
 * and economics. Copy is VERBATIM from the locked master pitch — update both
 * files together if the copy ever changes.
 *
 * QR_B64 is the lime QR linking to omniply.io/walkthrough (baked at build
 * time by scripts; regenerate per render-debrief.js header instructions).
 */

export const QR_B64 = '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'

export interface DebriefTemplateData {
  preparedFor: string // already HTML-escaped by caller
  scanDate: string // e.g. "04 AUG 2026"
  totalScore: number
  scoreRead: string
  barsHtml: string
  verdictHtml: string
  totalLeak: string // formatted money
  driftLeak: string
  respLeak: string
  /** Big call-count figure, e.g. "≈ 6" (missed-call sweep Part 1). */
  missBig: string
  /** Unit line under it, e.g. "calls a week". */
  missUnit: string
  /** One-line consequence or no-miss fallback (pre-escaped HTML, may contain <b>). */
  missLine: string
  /** Underestimate reframe or strong-practice softener. */
  missReframe: string
  mult: number
  fee: string // formatted money (their visit fee)
  feeYear: string // formatted money (fee × 12)
}

export function buildBarsHtml(
  scores: { content: number; speed: number; reviews: number; retention: number },
  weakest: string,
): string {
  const rows: Array<[string, string]> = [
    ['content', 'Content & Visibility'],
    ['speed', 'Speed-to-Lead & After-Hours'],
    ['reviews', 'Google Review Engine'],
    ['retention', 'Patient Retention & Recall'],
  ]
  return rows
    .map(([axis, label]) => {
      const val = scores[axis as keyof typeof scores]
      const weak = axis === weakest
      return (
        '<div class="bar' + (weak ? ' weak' : '') + '">' +
        '<div class="row1"><span class="name">' + label + (weak ? ' — weakest' : '') + '</span>' +
        '<span class="val">' + val + '</span></div>' +
        '<div class="track"><div class="fill" style="width:' + val + '%"></div></div></div>'
      )
    })
    .join('\n')
}

export function buildDebriefHtml(d: DebriefTemplateData): string {
  const C = 2 * Math.PI * 52
  const arcOffset = (C * (1 - d.totalScore / 100)).toFixed(1)
  const P = (n: number) => 'P.' + String(n).padStart(2, '0') + ' — 15'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>X-Ray Debrief</title>
<style>
  :root {
    --bg0: #0E0E0F; --bg1: #18181A; --bg2: #2A2A2D; --line: #343434;
    --ink: #FFFFFF; --dim: #A0A0A5; --faint: #8E8E95;
    --lime: #C3F43B; --signal: #E4604E;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: 8.5in 11in; margin: 0; }
  html, body { background: #000; }
  .page {
    position: relative; width: 8.5in; height: 11in;
    background: var(--bg0); color: var(--ink); font-family: var(--sans);
    overflow: hidden; page-break-after: always;
    padding: 0.85in 0.9in 0.75in; display: flex; flex-direction: column;
  }
  .rm { position: absolute; width: 0.16in; height: 0.16in; }
  .rm.tl { top: 0.3in; left: 0.3in; border-top: 1px solid var(--faint); border-left: 1px solid var(--faint); }
  .rm.tr { top: 0.3in; right: 0.3in; border-top: 1px solid var(--faint); border-right: 1px solid var(--faint); }
  .rm.bl { bottom: 0.3in; left: 0.3in; border-bottom: 1px solid var(--faint); border-left: 1px solid var(--faint); }
  .rm.br { bottom: 0.3in; right: 0.3in; border-bottom: 1px solid var(--faint); border-right: 1px solid var(--faint); }
  .head {
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: var(--mono); font-size: 8.5pt; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--dim); margin-bottom: 0.5in;
  }
  .head b { color: var(--ink); font-weight: 600; }
  .foot {
    margin-top: auto; padding-top: 0.3in; display: flex; justify-content: space-between;
    font-family: var(--mono); font-size: 8pt; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--faint);
  }
  .eyebrow {
    font-family: var(--mono); font-size: 10.5pt; letter-spacing: 0.26em;
    text-transform: uppercase; color: var(--lime); margin-bottom: 0.28in;
  }
  h1.display { font-size: 46pt; line-height: 1.04; font-weight: 750; letter-spacing: -0.02em; }
  h2.sect { font-size: 25pt; line-height: 1.14; font-weight: 700; letter-spacing: -0.015em; margin-bottom: 0.26in; }
  .big { font-size: 31pt; line-height: 1.13; font-weight: 720; letter-spacing: -0.018em; }
  p.body { font-size: 12pt; line-height: 1.58; color: var(--ink); max-width: 5.8in; margin-bottom: 0.16in; }
  p.body.dim { color: var(--dim); }
  p.body b { font-weight: 680; }
  em { font-style: italic; }
  .lime { color: var(--lime); }
  .signal { color: var(--signal); }
  .scanline {
    height: 2px; width: 100%; margin: 0.42in 0;
    background: linear-gradient(90deg, transparent, var(--lime) 30%, var(--lime) 70%, transparent);
    box-shadow: 0 0 18px 2px rgba(195,244,59,0.35);
  }
  .forcenum { font-family: var(--mono); font-size: 40pt; font-weight: 700; color: var(--bg2); line-height: 1; margin: 0.22in 0 0.12in; }
  .forcenum.xl { font-size: 64pt; margin: 0 0 0.2in; }
  .forcename { font-family: var(--mono); font-size: 11pt; letter-spacing: 0.3em; text-transform: uppercase; color: var(--lime); margin-bottom: 0.2in; }
  .statband {
    display: flex; gap: 0.35in; margin: 0.28in 0 0.2in;
    border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 0.28in 0;
  }
  .stat { flex: 1; }
  .stat .n { font-size: 28pt; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat .l { font-family: var(--mono); font-size: 8.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); margin-top: 8px; line-height: 1.6; }
  .fnmark { color: var(--lime); font-size: 60%; vertical-align: super; }
  .quoteblock { border-left: 2.5px solid var(--signal); padding: 0.1in 0 0.1in 0.32in; margin: 0.32in 0; }
  .inset {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 0.26in 0.3in; margin: 0.25in 0; max-width: 5.8in;
  }
  .inset p { font-size: 11.5pt; line-height: 1.6; color: var(--ink); }
  .inset .lbl { font-family: var(--mono); font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase; color: var(--lime); margin-bottom: 8px; }
  .partname { font-size: 17pt; font-weight: 720; margin-bottom: 0.12in; }
  .partname .dot { color: var(--lime); }
  .part { margin-bottom: 0.38in; }
  .mathrow { display: flex; align-items: center; gap: 0.4in; margin: 0.45in 0; }
  .mathcard { flex: 1; background: var(--bg1); border: 1px solid var(--line); border-radius: 12px; padding: 0.32in; text-align: center; }
  .mathcard .v { font-size: 30pt; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .mathcard .k { font-family: var(--mono); font-size: 8.5pt; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dim); margin-top: 10px; }
  .vs { font-family: var(--mono); font-size: 12pt; color: var(--faint); }
  .ctabox {
    background: var(--lime); color: #0B0B0C; border-radius: 14px;
    padding: 0.42in 0.5in; margin-top: 0.45in; display: flex; align-items: center; gap: 0.45in;
  }
  .ctabox .t { font-size: 19pt; font-weight: 750; line-height: 1.2; letter-spacing: -0.01em; }
  .ctabox .u { font-family: var(--mono); font-size: 10pt; margin-top: 10px; letter-spacing: 0.06em; }
  .ctabox img { width: 1.5in; height: 1.5in; border-radius: 8px; flex: none; }
  .srcs { font-family: var(--mono); font-size: 8pt; line-height: 1.9; color: var(--faint); letter-spacing: 0.02em; max-width: 6in; }
  .srcs b { color: var(--dim); font-weight: 600; }
  .loopwrap { display: flex; justify-content: center; margin: 0.3in 0 0.1in; }
  ul.prog { list-style: none; margin-top: 0.1in; }
  ul.prog li { position: relative; padding-left: 0.34in; margin-bottom: 0.24in; font-size: 12.5pt; line-height: 1.6; max-width: 5.9in; }
  ul.prog li::before { content: "+"; position: absolute; left: 0; top: 1px; color: var(--lime); font-family: var(--mono); font-size: 14pt; font-weight: 700; }

  /* ── Results page (film card, mirrors the app) ── */
  .film {
    position: relative; background: var(--bg1); border: 1px solid var(--line);
    border-radius: 14px; padding: 0.32in 0.3in 0.3in; margin-bottom: 0.18in;
  }
  .film::before, .film::after { content: ""; position: absolute; width: 0.15in; height: 0.15in; pointer-events: none; }
  .film::before { top: 0.1in; left: 0.1in; border-top: 1px solid var(--dim); border-left: 1px solid var(--dim); }
  .film::after { bottom: 0.1in; right: 0.1in; border-bottom: 1px solid var(--dim); border-right: 1px solid var(--dim); }
  .dialwrap { display: flex; align-items: center; gap: 0.32in; margin-bottom: 0.24in; }
  .dial { width: 1.5in; height: 1.5in; flex: none; }
  .dialcap .lbl { font-family: var(--mono); font-size: 8.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim); margin-bottom: 6px; }
  .dialcap .read { font-size: 12pt; line-height: 1.5; color: var(--ink); max-width: 4in; }
  .bars { display: flex; flex-direction: column; gap: 0.14in; }
  .bar .row1 { display: flex; justify-content: space-between; font-size: 10.5pt; margin-bottom: 5px; }
  .bar .name { color: var(--ink); }
  .bar .val { font-family: var(--mono); font-size: 9pt; color: var(--dim); font-variant-numeric: tabular-nums; }
  .bar .track { height: 5px; background: var(--bg2); border-radius: 3px; overflow: hidden; }
  .bar .fill { height: 100%; background: var(--lime); border-radius: 3px; }
  .bar.weak .name, .bar.weak .val { color: var(--signal); }
  .bar.weak .fill { background: var(--signal); }
  .verdict { border-left: 2px solid var(--signal); padding: 2px 0 2px 0.22in; margin-top: 0.24in; font-size: 11.5pt; line-height: 1.55; }
  .verdict b { color: var(--signal); }
  .leakcard { text-align: center; padding: 0.34in 0.3in 0.3in; }
  .leakcard .lbl { font-family: var(--mono); font-size: 8.5pt; letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); }
  .leaknum { font-size: 46pt; font-weight: 750; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.05; margin: 0.1in 0 0; }
  .leaknum small { font-size: 0.38em; font-weight: 500; color: var(--dim); letter-spacing: 0; }
  .leakunder { width: 0.9in; height: 3px; background: var(--signal); margin: 0.12in auto 0.18in; border-radius: 2px; }
  .leaksplit { display: flex; justify-content: center; gap: 0.5in; }
  .leaksplit div { font-size: 10.5pt; color: var(--dim); }
  .leaksplit b { display: block; color: var(--ink); font-size: 15pt; font-variant-numeric: tabular-nums; font-weight: 650; }
  .punch { margin: 0.18in auto 0; max-width: 5in; font-size: 12pt; line-height: 1.55; }
  .punch b { color: var(--lime); }
</style>
</head>
<body>

<!-- P1 · COVER — eyebrow pinned top, title starts at 50% -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="eyebrow" style="margin-bottom: 0;">Omniply &middot; Following your Practice X-Ray</div>
  <div style="position: absolute; top: 5.5in; left: 0.9in; right: 0.9in;">
    <h1 class="display">X-Ray<br />Debrief</h1>
    <div class="scanline"></div>
    <p class="body dim" style="font-size: 14pt; max-width: 4.9in;">The treatment plan for the leak your X-Ray found.</p>
    <div style="font-family: var(--mono); font-size: 10.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: #C9C9CF; margin-top: 0.35in;">
      Prepared for <span style="color: var(--ink);">${d.preparedFor}</span> &middot; ${d.scanDate}
    </div>
  </div>
  <div class="foot"><span>Confidential &middot; Prepared from your X-Ray answers</span><span>omniply.io</span></div>
</div>

<!-- P2 · YOUR X-RAY RESULTS -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>00 &middot; Your X-Ray Results</span></div>
  <div class="film">
    <div class="dialwrap">
      <svg class="dial" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#343434" stroke-width="7" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="#C3F43B" stroke-width="7" stroke-linecap="round"
                transform="rotate(-90 60 60)" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${arcOffset}" />
        <text x="60" y="66" text-anchor="middle" font-size="34" fill="#FFFFFF" font-family="-apple-system, Arial" font-weight="700">${d.totalScore}</text>
        <text x="60" y="84" text-anchor="middle" font-size="9" fill="#A0A0A5" font-family="ui-monospace, monospace">/ 100</text>
      </svg>
      <div class="dialcap">
        <div class="lbl">Practice Omniply Score &middot; ${d.preparedFor}</div>
        <div class="read">${d.scoreRead}</div>
      </div>
    </div>
    <div class="bars">
${d.barsHtml}
    </div>
    <div class="verdict">${d.verdictHtml}</div>
  </div>
  <div class="film leakcard">
    <div class="lbl">Calls &amp; messages nobody answers live</div>
    <div class="leaknum">${d.missBig}<small> ${d.missUnit}</small></div>
    <div class="leakunder"></div>
    <p style="margin: 0 0 4pt; font-size: 11.5pt; line-height: 1.5;">${d.missLine}</p>
    <p style="margin: 0 0 14pt; font-size: 9.5pt; color: var(--dim);">${d.missReframe}</p>
    <div class="leaksplit">
      <div>Patient drift adds<b>${d.driftLeak}</b></div>
      <div>Total monthly leak<b>${d.totalLeak}</b></div>
    </div>
    <p class="punch">That's &asymp; <b>${d.mult}&times;</b> the monthly cost of fixing it. The pages that follow are the treatment plan.</p>
  </div>
  <div class="foot"><span>${P(2)}</span><span>omniply.io</span></div>
</div>

<!-- P3 · §1 THE FRAME + §2 OPENER -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>01 &middot; The Frame</span></div>
  <div class="big" style="margin-bottom: 0.35in;">An X-ray doesn't lie.</div>
  <p class="body">It doesn't exaggerate, it doesn't flatter, and it doesn't care how long you've been in practice. It shows the thing you couldn't see. And once you've seen it, you can't unsee it.</p>
  <p class="body">You've seen yours. Your practice has a leak. Now you know roughly what it costs you every month, and you know which part of the machine is lagging behind.</p>
  <p class="body">This is the treatment plan. Read it the way you'd want a patient to read yours: not as entertainment. As the difference between managing a problem and living with one.</p>
  <div class="scanline" style="margin: 0.35in 0;"></div>
  <h2 class="sect" style="margin-top: 35px;">Why this is happening<br />to good practices.</h2>
  <p class="body">First, understand that the leak is not your fault. Three forces created it, none of them asked your permission, and all three are permanent.</p>
  <div class="foot"><span>${P(3)}</span><span>omniply.io</span></div>
</div>

<!-- P4 · FORCES 01 + 02 -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>02 &middot; The Big Change</span></div>
  <div class="forcenum" style="margin-top: 0;">01</div>
  <div class="forcename">The technology force</div>
  <p class="body">Every patient in your town now carries every competitor's front desk in their pocket. When someone's back seizes at 9pm, they don't wait for your opening hours...</p>
  <p class="body">They search, they message, and they book with whoever answers. Google decides who exists. The map pack decides who gets the call.</p>
  <p class="body">And a newer layer is settling on top: patients now ask AI assistants the question they used to type into Google... "who should I see about this?" The answer engines read the same signals, reviews, real content, responsiveness. A practice those engines can't read doesn't lose the comparison. It never comes up.</p>
  <div class="forcenum" style="margin-top: 0.58in;">02</div>
  <div class="forcename">The social force</div>
  <p class="body">Patients stopped calling back. Not because they're rude... because Amazon, Uber and a decade of instant everything trained them.</p>
  <div class="statband">
    <div class="stat"><div class="n">78%<span class="fnmark">*</span></div><div class="l">of customers buy from whoever answers first</div></div>
    <div class="stat"><div class="n lime">100&times;<span class="fnmark">*</span></div><div class="l">more likely to connect in 5 min vs. 30 min</div></div>
    <div class="stat"><div class="n signal">2 days</div><div class="l">the average business's response time</div></div>
  </div>
  <p class="body">And loyalty quietly became a subscription that simply gets canceled by silence.</p>
  <div class="foot"><span>${P(4)} &nbsp;&middot;&nbsp; * sources on the back page</span><span>omniply.io</span></div>
</div>

<!-- P5 · FORCE 03 -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>02 &middot; The Big Change</span></div>
  <div class="forcenum xl">03</div>
  <div class="forcename">The economic force</div>
  <p class="body">The compounding asset in healthcare used to be location and reputation. Now it's attention and reviews. The practices growing right now are not better clinicians than you. They run better systems... and every month, the gap between good-clinician practices and good-system practices gets more expensive to close.</p>
  <div class="quoteblock" style="border-color: var(--lime); margin-top: 0.55in;">
    <div class="big">Ten years ago, "great care plus word of mouth" was a growth strategy.<br /><br />Today that's a lottery ticket.</div>
  </div>
  <div class="foot"><span>${P(5)}</span><span>omniply.io</span></div>
</div>

<!-- P6 · §3 BELIEF SHIFT -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>03 &middot; The Belief Shift</span></div>
  <h2 class="sect">You've already tried the obvious fix. It's called <em>trying harder.</em></h2>
  <p class="body">The problem is that you and your staff are busy. Posting at 11 pm doesn't move the needle because everybody is asleep.</p>
  <p class="body">Telling your front desk to follow up when it's quiet is a losing strategy because your clients expect instant answers today. And asking for a Google review when you remember, and only from the patients you're sure will say yes, means that other clinics win the Google Map pack.</p>
  <p class="body">So the real problem is that you need to get consistent systematically. That's exactly what all the expensive chiropractic coaches sell.</p>
  <p class="body">But then you hit the actual problem... it's not a discipline problem, it's a <b>physics problem.</b></p>
  <div class="big" style="margin: 0.32in 0; font-size: 27pt;">Attention now runs 24 hours a day. <span class="lime">Humans don't.</span></div>
  <p class="body">You need sleep. Your family needs you. Your kids need guidance. And sometimes you also need to rest...</p>
  <p class="body">So, you cannot out-hustle a force that never sleeps... you can only <b>out-system it.</b></p>
  <div class="foot"><span>${P(6)}</span><span>omniply.io</span></div>
</div>

<!-- P7 · §3 DRIFT -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>03 &middot; The Belief Shift</span></div>
  <p class="body">And the leak this physics creates is the quietest one in your business: <b>patient drift.</b></p>
  <p class="body">A patient finishes their care plan. They feel good, which means your care <em>worked</em>.</p>
  <p class="body">But then nothing happens. No contact, no content, no reason to think of you.</p>
  <p class="body">Then eight months later their back flares up. But you are in a city full of clinics that answer faster than you, and they have likely multiple chiros saved in their phones... how many electricians do you have stored in <em>your</em> phone for emergencies?</p>
  <p class="body"><b>Exactly!</b></p>
  <p class="body">And if you don't, you'll call the first one listed in Google Maps that responds... correct?</p>
  <div class="quoteblock">
    <div class="big"><span class="signal">Patients don't leave. They fade.</span> And fading is invisible in the appointment book until the quarter is already soft.</div>
  </div>
  <div class="foot"><span>${P(7)}</span><span>omniply.io</span></div>
</div>

<!-- P8 · §4 THE LOOP -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>04 &middot; The Mechanism</span></div>
  <h2 class="sect">The <span class="lime">Omniply Loop</span></h2>
  <p class="body">So the solution is what we call the <b>Omniply Loop</b> because it multiplies your omni-channel exposure where your clients pay attention all day.</p>
  <p class="body">For a chiropractic practice that's tired of marketing being a second job, what fixes this is not a tool. It's a loop. Four parts, each feeding the next:</p>
  <div class="loopwrap">
    <svg width="430" height="430" viewBox="0 0 430 430">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#C3F43B" />
        </marker>
      </defs>
      <g fill="none" stroke="#C3F43B" stroke-width="2">
        <path d="M 262 78 A 150 150 0 0 1 352 168" marker-end="url(#ah)" />
        <path d="M 352 262 A 150 150 0 0 1 262 352" marker-end="url(#ah)" />
        <path d="M 168 352 A 150 150 0 0 1 78 262" marker-end="url(#ah)" />
        <path d="M 78 168 A 150 150 0 0 1 168 78" marker-end="url(#ah)" />
      </g>
      <g font-family="ui-monospace, Menlo, monospace" font-size="13" letter-spacing="2" text-anchor="middle">
        <g>
          <rect x="140" y="30" width="150" height="44" rx="9" fill="#18181A" stroke="#343434" />
          <text x="215" y="57" fill="#FFFFFF">PRESENCE</text>
        </g>
        <g>
          <rect x="330" y="193" width="94" height="44" rx="9" fill="#18181A" stroke="#343434" transform="translate(-24 0)" />
          <text x="353" y="220" fill="#FFFFFF">PROOF</text>
        </g>
        <g>
          <rect x="140" y="356" width="150" height="44" rx="9" fill="#18181A" stroke="#343434" />
          <text x="215" y="383" fill="#FFFFFF">RECALL</text>
        </g>
        <g>
          <rect x="6" y="193" width="140" height="44" rx="9" fill="#18181A" stroke="#343434" />
          <text x="76" y="220" fill="#FFFFFF">RESPONSE</text>
        </g>
        <text x="215" y="208" fill="#A0A0A5" font-size="11">THE</text>
        <text x="215" y="228" fill="#C3F43B" font-size="13">OMNIPLY LOOP</text>
      </g>
    </svg>
  </div>
  <div class="foot"><span>${P(8)}</span><span>omniply.io</span></div>
</div>

<!-- P9 · PRESENCE + RESPONSE -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>04 &middot; The Mechanism</span></div>
  <div class="part">
    <div class="partname"><span class="dot">&#9679;</span> Presence</div>
    <p class="body">Real content — posts, articles, a newsletter your patients actually read — produced for your practice, in your voice, every week, without you writing a word. Presence is what makes patients think of you <em>before</em> the pain does.</p>
    <p class="body">So when the emergency strikes, they remember who to call... you!</p>
  </div>
  <div class="part">
    <div class="partname"><span class="dot">&#9679;</span> Response</div>
    <p class="body">AI chat and voice that answer in seconds, at 2pm while you're adjusting or at 2am while you're asleep. So your clients can book the appointment on the spot. The inquiry you answer instantly is the patient your competitor never meets.</p>
    <div class="inset">
      <div class="lbl">Remember</div>
      <p>Reach them inside five minutes and you're 100&times; more likely to even get them on the line... and 78% book with whoever they can schedule with first.</p>
    </div>
    <p class="body">If not, they'll call the next chiro in the map pack without hesitation because they will go to whoever they can schedule the appointment with <em>first</em>!</p>
  </div>
  <div class="foot"><span>${P(9)}</span><span>omniply.io</span></div>
</div>

<!-- P10 · PROOF + RECALL -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>04 &middot; The Mechanism</span></div>
  <div class="part">
    <div class="partname"><span class="dot">&#9679;</span> Proof</div>
    <p class="body">A review engine that turns every happy patient into public evidence, automatically. Reviews compound like interest: invisible week to week, undeniable year to year.</p>
    <p class="body">Plus, fresh reviews are one of the strongest signals that decide who ranks first and gets the top spot in Google's Map pack...</p>
    <p class="body">A constant stream of new reviews increases your chances to be the first listing like nothing else. So anyone new in town that needs your help, can find you on the first page.</p>
  </div>
  <div class="part">
    <div class="partname"><span class="dot">&#9679;</span> Recall</div>
    <p class="body">Reactivation that never forgets a patient. Care plan ends, contact continues; nobody drifts unnoticed, and the ones who faded get a reason to come back... before the flare-up, not after.</p>
  </div>
  <div class="foot"><span>${P(10)}</span><span>omniply.io</span></div>
</div>

<!-- P11 · FLYWHEEL -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>04 &middot; The Mechanism</span></div>
  <div class="big" style="margin: 0.4in 0;">It's not four tools.<br /><span class="lime">It's one flywheel.</span></div>
  <p class="body">Watch what the loop does: presence keeps patients warm &rarr; warm patients return, and leave reviews &rarr; reviews bring new inquiries &rarr; instant response converts them &rarr; recall keeps them.</p>
  <p class="body">Break any link and the leak reopens somewhere else, which is exactly why buying point-solutions has never fixed it.</p>
  <p class="body">Which is exactly why all the chiro practice coaching just hands the discipline problem back to you. <b>The loop removes it.</b></p>
  <div class="foot"><span>${P(11)}</span><span>omniply.io</span></div>
</div>

<!-- P12 · §5 THE PROGNOSIS -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>05 &middot; The Prognosis</span></div>
  <h2 class="sect">The Prognosis.</h2>
  <p class="body dim">What your practice looks like ninety days into treatment:</p>
  <ul class="prog">
    <li>The 2am back-spasm call answered, and booked, while you're asleep... so Monday's schedule fills itself before your competitor's front desk even gets in.</li>
    <li>A newsletter your patients actually open... written, designed and sent every week, without you typing a word of it.</li>
    <li>Fresh Google reviews arriving quietly every week... the compounding kind your competitors can't fake and can't catch up to.</li>
    <li>Patients who "felt fine and faded" getting a reason to come back before the flare-up... not after they've already googled someone else.</li>
    <li>Your name showing up between visits, so when the pain hits, there's no search... just "call my chiro."</li>
    <li>And the one nobody puts on a features list: your evenings back. No more 11pm posting, no more "we should really ask for reviews"... no more marketing guilt.</li>
  </ul>
  <div class="foot"><span>${P(12)}</span><span>omniply.io</span></div>
</div>

<!-- P13 · §6 ECONOMICS (personalized) -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>06 &middot; The Economics</span></div>
  <h2 class="sect">The one-patient math.</h2>
  <p class="body">Now the part your X-Ray already did for you.</p>
  <p class="body">Take your average visit fee. A typical patient's first year is worth roughly twelve visits of it. The whole system costs $397 a month.</p>
  <div class="mathrow">
    <div class="mathcard"><div class="v" style="color: var(--dim);">${d.fee} &times; 12 = ${d.feeYear}</div><div class="k">one patient's first year, at your fee</div></div>
    <div class="vs">VS</div>
    <div class="mathcard"><div class="v lime">$397</div><div class="k">the whole system / month</div></div>
  </div>
  <div class="quoteblock" style="border-color: var(--lime);">
    <div class="big" style="font-size: 26pt;">Recovering one patient a month pays for the entire system. The second one is profit.</div>
  </div>
  <p class="body">And your X-Ray told you the leak is bigger than two: <b>${d.totalLeak}/month &asymp; ${d.mult}&times;</b> the cost of fixing it.</p>
  <p class="body">That's the entire business case. No projections, no hockey sticks... just your own numbers, doing arithmetic you can check.</p>
  <div class="foot"><span>${P(13)}</span><span>omniply.io</span></div>
</div>

<!-- P14 · §7 PRIZE + CTA -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>07 &middot; The Prize</span></div>
  <p class="body">Omniply is not marketing software with a chiropractic template. It's built for chiropractic only. The content engine knows the difference between a subluxation and a slogan.</p>
  <p class="body">The onboarding reads your website, your brand, your specialties, and the system starts producing in hours, not weeks.</p>
  <p class="body"><b>We're not asking you to become a marketer. We're asking you to stop having to be one.</b></p>
  <p class="body">$397 a month. Everything in the loop. Cancel anytime. No setup fees, no lock-in, no salesperson.</p>
  <p class="body">Which is why the next step isn't a call. It's the actual system, on screen: what it posts, how it answers, what the recall messages look like. Watch it the way you'd read a scan. Then decide like a doctor decides: <b>on the evidence.</b></p>
  <div class="ctabox">
    <div>
      <div class="t">Watch the Practice Autopilot Walkthrough &rarr;</div>
      <div class="u">omniply.io/walkthrough</div>
    </div>
    <img src="data:image/png;base64,${QR_B64}" alt="QR code to the walkthrough" />
  </div>
  <div class="foot"><span>${P(14)}</span><span>omniply.io</span></div>
</div>

<!-- P15 · §8 CLOSE + SOURCES -->
<div class="page">
  <span class="rm tl"></span><span class="rm tr"></span><span class="rm bl"></span><span class="rm br"></span>
  <div class="head"><span><b>X-Ray Debrief</b></span><span>08 &middot; The Close</span></div>
  <div class="big" style="margin: 0.5in 0 0.4in;">You've seen the X-ray.<br />You know what untreated looks like...</div>
  <p class="body">You've watched it happen to patients who "felt fine."</p>
  <div class="big lime" style="margin: 0.4in 0 0.8in;">Treatment starts the day you decide it does.</div>
  <div class="srcs">
    <b>* Sources:</b> Oldroyd, J. — Lead Response Management Study (InsideSales, 2007): 100&times; contact odds within 5 minutes vs. 30. &nbsp;&middot;&nbsp; Oldroyd, McElheran &amp; Elkington, "The Short Life of Online Sales Leads," Harvard Business Review, March 2011 (1.25M leads): firms responding within an hour were nearly 7&times; as likely to qualify the lead as those an hour slower, and 60&times;+ vs. a day; average response 42 hours. &nbsp;&middot;&nbsp; Lead Connect survey: 78% of customers buy from the first responder.<br /><br />
    Leak estimates in this document are computed from your own X-Ray answers and stated, adjustable assumptions. They are illustrations, not guarantees or income claims.<br /><br />
    &copy; Omniply &middot; omniply.io &middot; Built for chiropractic practices only.
  </div>
  <div class="foot"><span>${P(15)}</span><span>omniply.io</span></div>
</div>

</body>
</html>`
}
