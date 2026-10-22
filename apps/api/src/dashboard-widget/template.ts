/**
 * "AI Employee" dashboard embed page (snapshot-optimization 2026-10-21).
 *
 * Rendered inside a GHL dashboard URL widget, so the page is styled as the
 * CARD INTERIOR. Deliberately single-theme in the OMNIPLY EMBED language
 * (apps/web/src/app/embed/EmbedShell.tsx: card #122535 on the hero-gradient
 * ground, border #2B3E52, ink #FFFFFF/#A0A0A5, accent #C3F43B) so the panel
 * reads as one of the platform's own cards; every surface color is explicit
 * so the iframe never inherits the host ground. Fully responsive: the user
 * free-resizes the widget.
 *
 * Modes:
 *   live    — fetches <page-url>/data?days=N (token stays in the URL only)
 *   sample  — deterministic generated data, for design review without a DB
 *   pending — pre-onboarding placeholder (the snapshot's neutral default)
 */

const STYLE = `
  :root {
    --bg: #122535;
    --ink: #ffffff;
    --muted: #a0a0a5;
    --line: #2b3e52;
    --tile: #0e2032;
    --accent: #c3f43b;
    --accent-soft: #1a3246;
    --accent-ink: #0e0e0f;
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg);
    color: var(--ink);
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 18px 20px 14px;
  }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .head h1 { font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
  .head .live { display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 600; color: var(--accent); vertical-align: 1px; }
  .live .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-right: 4px; animation: pulse 2.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
  @media (prefers-reduced-motion: reduce) { .live .dot { animation: none } }
  .range { display: flex; gap: 4px; background: var(--tile); border: 1px solid var(--line); border-radius: 8px; padding: 3px; }
  .range button {
    border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: 6px; cursor: pointer;
  }
  .range button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }
  .range button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .stat { background: var(--tile); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px 11px; min-width: 0; }
  .stat .label { font-size: 11.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .stat .num { font-size: clamp(26px, 4.5vw, 38px); font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .stat .sub { font-size: 11.5px; color: var(--muted); min-height: 16px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 2px 0; color: var(--muted); font-size: 12px; }
  .chips b { color: var(--ink); font-weight: 650; font-variant-numeric: tabular-nums; }
  .band { margin-top: 14px; }
  .band-title { font-size: 11.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
  .hero.compact .num { font-size: clamp(20px, 3.5vw, 28px); }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; margin-top: 12px; }
  .panel { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; min-width: 0; }
  .panel h2 { font-size: 11.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 10px; }
  .ch-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .ch-row .ch-label { flex: 0 0 86px; font-size: 12px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ch-row .ch-track { flex: 1; height: 8px; background: var(--tile); border-radius: 4px; overflow: hidden; }
  .ch-row .ch-fill { height: 100%; background: var(--accent); border-radius: 4px; }
  .ch-row .ch-n { flex: 0 0 auto; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .trend { display: flex; align-items: flex-end; gap: 2px; height: 104px; }
  .trend .bar { flex: 1 1 0; min-width: 1px; background: var(--accent); opacity: .85; border-radius: 2px 2px 0 0; }
  .trend .bar.zero { background: var(--line); opacity: 1; }
  .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 6px; }
  .empty { color: var(--muted); font-size: 12.5px; padding: 8px 0; }
  .foot { margin-top: 12px; font-size: 11px; color: var(--muted); }
  .note { text-align: center; padding: 48px 20px; }
  .note h1 { font-size: 16px; font-weight: 650; margin-bottom: 8px; }
  .note p { color: var(--muted); max-width: 420px; margin: 0 auto; }
`

const BODY = `
  <div class="head">
    <h1>AI Employee<span class="live"><span class="dot"></span>LIVE</span></h1>
    <div class="range" role="group" aria-label="Date range">
      <button data-days="7" aria-pressed="false">7d</button>
      <button data-days="30" aria-pressed="true">30d</button>
      <button data-days="90" aria-pressed="false">90d</button>
    </div>
  </div>
  <div class="hero">
    <div class="stat"><div class="label">Appointments booked</div><div class="num" id="n-booked">–</div><div class="sub" id="s-booked"></div></div>
    <div class="stat"><div class="label">New patients captured</div><div class="num" id="n-new">–</div><div class="sub">contacts created by AI</div></div>
    <div class="stat"><div class="label">Booking links sent</div><div class="num" id="n-links">–</div><div class="sub">patients sent to scheduling</div></div>
    <div class="stat"><div class="label">After-hours answers</div><div class="num" id="n-ah">–</div><div class="sub" id="s-ah"></div></div>
  </div>
  <div class="chips" id="chips"></div>
  <div class="band" id="practice" hidden>
    <h2 class="band-title">Practice</h2>
    <div class="hero compact" id="practice-tiles"></div>
  </div>
  <div class="charts">
    <div class="panel"><h2>Conversations by channel</h2><div id="channels"></div></div>
    <div class="panel"><h2>Daily activity</h2><div class="trend" id="trend"></div><div class="axis" id="axis"></div></div>
  </div>
  <div class="foot" id="foot"></div>
`

const SCRIPT = `
  var CH_LABELS = { voice: 'Phone calls', webchat: 'Website chat', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', 'agent-protocol': 'AI assistants' };
  var state = { days: 30 };

  function el(id) { return document.getElementById(id); }
  function n(v) { return (v || 0).toLocaleString(); }

  function render(d) {
    var t = d.totals;
    el('n-booked').textContent = n(t.booked);
    el('s-booked').textContent = t.bookedCliniko > 0 ? n(t.bookedGhl) + ' CRM \\u00b7 ' + n(t.bookedCliniko) + ' Cliniko' : 'into your calendar';
    el('n-new').textContent = n(t.newContacts);
    el('n-links').textContent = n(t.bookingLinksSent);
    el('n-ah').textContent = n(t.afterHours);
    el('s-ah').textContent = t.overflow > 0 ? '+ ' + n(t.overflow) + ' busy-line pickups' : 'nights & weekends covered';

    var chips = '<span><b>' + n(t.conversations) + '</b> conversations</span>';
    if (t.voiceMinutes > 0) chips += '<span><b>' + n(t.voiceMinutes) + '</b> call minutes</span>';
    if (t.callbacks > 0) chips += '<span><b>' + n(t.callbacks) + '</b> callbacks arranged</span>';
    if (t.guidesSent > 0) chips += '<span><b>' + n(t.guidesSent) + '</b> guides delivered</span>';
    if (t.handoffs > 0) chips += '<span><b>' + n(t.handoffs) + '</b> handed to your team</span>';
    el('chips').innerHTML = chips;

    var pr = d.practice || {};
    function tile(label, num, sub) {
      return '<div class="stat"><div class="label">' + label + '</div><div class="num">' + num + '</div><div class="sub">' + sub + '</div></div>';
    }
    var ptiles = '';
    if (pr.appointments != null) {
      ptiles += tile('All appointments', n(pr.appointments), t.booked > 0 ? n(t.booked) + ' booked by your AI' : 'across your calendars');
    }
    if (pr.rating != null) {
      var rsub = pr.reviewCount != null ? n(pr.reviewCount) + ' reviews' : '';
      if (pr.reviewGrowth != null && pr.reviewGrowth > 0) {
        rsub += ' \\u00b7 +' + n(pr.reviewGrowth) + (pr.growthSince ? ' since ' + fmtDate(pr.growthSince) : '');
      }
      ptiles += tile('Google rating', pr.rating.toFixed(1) + ' \\u2605', rsub);
    }
    if (pr.reviewRequests != null) {
      ptiles += tile('Review requests', n(pr.reviewRequests), 'sent this period');
    }
    if (pr.unread != null) {
      ptiles += tile('Inbox', n(pr.unread), 'unread conversations');
    }
    el('practice-tiles').innerHTML = ptiles;
    el('practice').hidden = !ptiles;

    var entries = Object.keys(d.byChannel).map(function (k) { return [k, d.byChannel[k]]; })
      .filter(function (e) { return e[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var max = entries.length ? entries[0][1] : 0;
    el('channels').innerHTML = entries.length
      ? entries.map(function (e) {
          var pct = Math.max(3, Math.round((e[1] / max) * 100));
          return '<div class="ch-row"><span class="ch-label">' + CH_LABELS[e[0]] + '</span>' +
                 '<span class="ch-track"><span class="ch-fill" style="width:' + pct + '%"></span></span>' +
                 '<span class="ch-n">' + n(e[1]) + '</span></div>';
        }).join('')
      : '<div class="empty">No conversations in this period yet.</div>';

    var dmax = 1;
    d.byDay.forEach(function (x) { if (x.count > dmax) dmax = x.count; });
    el('trend').innerHTML = d.byDay.map(function (x) {
      var h = x.count === 0 ? 3 : Math.max(6, Math.round((x.count / dmax) * 100));
      return '<div class="bar' + (x.count === 0 ? ' zero' : '') + '" style="height:' + h + '%" title="' + x.date + ': ' + x.count + '"></div>';
    }).join('');
    var first = d.byDay[0], last = d.byDay[d.byDay.length - 1];
    el('axis').innerHTML = first ? '<span>' + fmtDate(first.date) + '</span><span>' + fmtDate(last.date) + '</span>' : '';

    el('foot').textContent = 'Last ' + d.days + ' days \\u00b7 updates live \\u00b7 Omniply AI';
  }

  function fmtDate(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function load() {
    document.querySelectorAll('.range button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.days === state.days));
    });
    getStats(state.days).then(render).catch(function () {
      el('chips').innerHTML = '<span>Couldn\\u2019t load activity right now \\u2014 it will retry on the next refresh.</span>';
    });
  }
  document.querySelectorAll('.range button').forEach(function (b) {
    b.addEventListener('click', function () { state.days = +b.dataset.days; load(); });
  });
  load();
`

/** Live mode: fetch stats from the page's own /data sibling (token stays URL-only). */
const LIVE_GETTER = `
  function getStats(days) {
    var base = location.pathname.replace(/\\/+$/, '');
    return fetch(base + '/data?days=' + days).then(function (r) {
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json();
    });
  }
`

/** Sample mode: deterministic generated clinic month, for design review. */
const SAMPLE_GETTER = `
  function getStats(days) {
    var seed = 42;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var byDay = [], total = 0, now = Date.now();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now - i * 86400000);
      var wk = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      var c = Math.round(rnd() * (wk ? 3 : 7)) + (wk ? 0 : 2);
      total += c;
      byDay.push({ date: d.toISOString().slice(0, 10), count: c });
    }
    function part(f) { return Math.round(total * f); }
    return Promise.resolve({
      days: days,
      totals: {
        conversations: total,
        booked: part(0.17), bookedGhl: part(0.13), bookedCliniko: part(0.04),
        bookingLinksSent: part(0.07), newContacts: part(0.42),
        afterHours: part(0.31), overflow: part(0.11),
        guidesSent: part(0.09), callbacks: part(0.05), handoffs: part(0.03),
        voiceMinutes: Math.round(total * 0.38 * 3.2),
      },
      byChannel: {
        voice: part(0.38), webchat: part(0.30), facebook: part(0.12),
        instagram: part(0.08), whatsapp: part(0.09), 'agent-protocol': part(0.03),
      },
      practice: {
        appointments: part(0.55), unread: 3, rating: 4.8, reviewCount: 213,
        reviewRequests: part(0.14), reviewGrowth: Math.max(2, part(0.03)), growthSince: null,
      },
      byDay: byDay,
    });
  }
`

export function buildDashboardWidgetHtml(mode: 'live' | 'sample'): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AI Employee</title>
<style>${STYLE}</style>
</head>
<body>
${BODY}
<script>${mode === 'sample' ? SAMPLE_GETTER : LIVE_GETTER}${SCRIPT}</script>
</body>
</html>`
}

export function buildDashboardPendingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AI Employee</title>
<style>${STYLE}</style>
</head>
<body>
<div class="note">
  <h1>Your AI Employee dashboard is almost ready</h1>
  <p>This panel comes to life once onboarding completes — it will show the appointments, new patients, and after-hours conversations your AI handles.</p>
</div>
</body>
</html>`
}
