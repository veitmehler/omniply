/**
 * Calendar seasonal-integrity fix (Veit approved 2026-09-30).
 * A) Judge: deterministic heuristic + conservative LLM pass over every
 *    article & newsletter calendar row (date+hemisphere vs text).
 * B) Replace: minimal-edit rewrites (prefer fixing the broken anchor,
 *    e.g. "December Heat"->"Summer Heat"; else a new date-fit topic),
 *    style-matched to neighbors, no duplicates within the calendar.
 * C) Apply: update rows by id; nl rows also reset research (stale).
 *    Rename the "Nothern" typo calendar.
 * D) Verify: re-run heuristic; log everything to /tmp/calfix/.
 */
const fs = require('fs')
const { PrismaClient } = require('/app/node_modules/@prisma/client')
const { getSystemApiKey } = require('/app/dist/lib/system-keys')
const MODEL = 'claude-sonnet-4-5-20250929'
const OUT = '/tmp/calfix'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function heuristic(dateStr, text, hemi) {
  const m = parseInt(dateStr.slice(5,7), 10)
  const s = text.toLowerCase()
  const north = hemi !== 'south'
  const summerM = north ? [6,7,8] : [12,1,2]
  const winterM = north ? [12,1,2] : [6,7,8]
  const has = (re) => re.test(s)
  if (winterM.includes(m) && has(/summer|beach day|heatwave|pool season/)) return 'winter-month/summer-text'
  if (summerM.includes(m) && has(/\bwinter\b|snow|chilly|cold outside/)) return 'summer-month/winter-text'
  if (has(/december heat|december sun/) && m !== 12) return 'says-december/not-december'
  if (has(/easter/) && ![3,4].includes(m)) return 'easter/wrong-month'
  if (has(/christmas|festive season|celebrating the holidays|holiday stress|post-holiday/) && ![11,12,1].includes(m)) return 'holidays/wrong-month'
  if (has(/mid-year/) && ![6,7].includes(m)) return 'mid-year/wrong-month'
  if (has(/back.to.school/) && !(north ? [8,9] : [1,2]).includes(m)) return 'back-to-school/wrong-month'
  if (has(/new year/) && ![12,1].includes(m)) return 'new-year/wrong-month'
  return null
}

let KEY = null
async function llm(prompt, maxTokens = 4000) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    if (res.ok) {
      const d = await res.json()
      return (d.content?.[0]?.text ?? '').trim()
    }
    const body = await res.text().catch(() => '')
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 4) { await sleep(20000); continue }
    throw new Error(`anthropic ${res.status}: ${body.slice(0,200)}`)
  }
}
function parseJson(text) {
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in LLM reply: ' + text.slice(0,150))
  return JSON.parse(m[0])
}
const chunk = (arr, n) => { const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out }

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const prisma = new PrismaClient()
  KEY = await getSystemApiKey('anthropic')
  if (!KEY) { console.error('FATAL no anthropic key'); process.exit(2) }
  const log = []
  const say = (s) => { console.log(s); log.push(s) }

  // ---------- collect ----------
  const aCals = await prisma.articleCalendar.findMany({ select: { id:true, name:true, hemisphere:true } })
  const nCals = await prisma.newsletterCalendar.findMany({ select: { id:true, name:true, hemisphere:true } })
  const work = []   // {kind, cal, rows:[{id,date,text,fields}]}
  for (const c of aCals) {
    const rows = await prisma.articleCalendarTopic.findMany({ where: { calendarId: c.id }, orderBy: { date:'asc' },
      select: { id:true, date:true, topic:true } })
    work.push({ kind:'article', cal:c, rows: rows.map(r => ({ id:r.id, date:r.date.toISOString().slice(0,10), text:r.topic })) })
  }
  for (const c of nCals) {
    const rows = await prisma.newsletterTopic.findMany({ where: { calendarId: c.id }, orderBy: { date:'asc' },
      select: { id:true, date:true, topic:true, bullet1:true, bullet2:true, bullet3:true, secondaryTopic:true, draftedAt:true } })
    work.push({ kind:'newsletter', cal:c, rows: rows.map(r => ({ id:r.id, date:r.date.toISOString().slice(0,10),
      text: [r.topic, r.bullet1, r.bullet2, r.bullet3, r.secondaryTopic].filter(Boolean).join(' · '),
      fields: { topic:r.topic, bullet1:r.bullet1, bullet2:r.bullet2, bullet3:r.bullet3, secondaryTopic:r.secondaryTopic, draftedAt:r.draftedAt } })) })
  }

  // ---------- judge ----------
  const violations = [] // {kind, cal, row, reason, source}
  for (const w of work) {
    if (!w.cal.hemisphere) { say(`SKIP (no hemisphere): ${w.cal.name}`); continue }
    const seen = new Set()
    for (const r of w.rows) {
      const h = heuristic(r.date, r.text, w.cal.hemisphere)
      if (h) { violations.push({ ...wRef(w), row:r, reason:h, source:'heuristic' }); seen.add(r.id) }
    }
    for (const part of chunk(w.rows, 80)) {
      const listing = part.map(r => `${r.date} | ${r.text.slice(0,160)}`).join('\n')
      const verdictText = await llm(
`You are auditing a content calendar for a chiropractic clinic in the ${w.cal.hemisphere.toUpperCase()}ERN hemisphere ("${w.cal.name}").
Each line is "date | topic". Flag ONLY clear, objective date/text mismatches an ordinary reader would notice:
- a named holiday at the wrong time of year (Easter, Christmas, New Year)
- a season word contradicting the date's season IN THIS HEMISPHERE
- an absolute month name in the text that contradicts the date
- school-calendar references wrong for this hemisphere (${w.cal.hemisphere === 'north' ? 'school starts Aug/Sep' : 'school starts late Jan/Feb'})
Do NOT flag: reasonable seasonal preparation a month or two early, metaphors, generic wellness topics, or anything debatable.
Reply with ONLY a JSON array: [{"date":"YYYY-MM-DD","reason":"<short>"}] — empty array if none.

${listing}`, 2000)
      let judged = []
      try { judged = parseJson(verdictText) } catch (e) { say(`WARN judge-parse ${w.cal.name}: ${e.message}`) }
      for (const j of judged) {
        const r = part.find(x => x.date === j.date)
        if (r && !seen.has(r.id)) { violations.push({ ...wRef(w), row:r, reason:'llm: '+j.reason, source:'llm' }); seen.add(r.id) }
      }
      await sleep(800)
    }
  }
  function wRef(w){ return { kind:w.kind, calId:w.cal.id, calName:w.cal.name, hemi:w.cal.hemisphere } }
  say(`\nTOTAL violations to fix: ${violations.length}`)
  fs.writeFileSync(OUT+'/violations.json', JSON.stringify(violations, null, 2))

  // ---------- replace ----------
  const byCal = {}
  violations.forEach(v => { (byCal[v.calId] = byCal[v.calId] || []).push(v) })
  const changes = []
  for (const calId of Object.keys(byCal)) {
    const vs = byCal[calId]
    const w = work.find(x => x.cal.id === calId)
    const existingTitles = new Set(w.rows.map(r => (r.fields?.topic ?? r.text).toLowerCase()))
    const items = vs.map((v,i) => {
      const idx = w.rows.findIndex(r => r.id === v.row.id)
      const neighbors = w.rows.slice(Math.max(0,idx-3), idx).concat(w.rows.slice(idx+1, idx+4))
        .map(r => (r.fields?.topic ?? r.text)).slice(0,6)
      return { n:i, date:v.row.date, current: v.kind==='newsletter' ? v.row.fields : { topic: v.row.text }, reason:v.reason, neighbors }
    })
    const isNl = vs[0].kind === 'newsletter'
    const fixText = await llm(
`You are fixing seasonal/date mismatches in a chiropractic ${isNl?'newsletter':'article'} calendar: "${vs[0].calName}" (${vs[0].hemi}ern hemisphere).
For each item below produce a corrected version that FITS the given date in this hemisphere.
Rules:
- PREFER the minimal edit that fixes the broken anchor (e.g. "Staying Hydrated in the December Heat" in June/north -> "Staying Hydrated in the Summer Heat"). If the concept cannot fit the date at all (e.g. Easter in October), write a NEW topic appropriate for that date, specialization and audience.
- Match the tone/style of the neighbor titles. Never duplicate an existing title in this calendar.
- Keep it chiropractic-relevant and audience-appropriate for the calendar's specialization.
${isNl ? '- Newsletter items have fields topic, bullet1..3, secondaryTopic: return ALL fields, editing only what is wrong and keeping the rest verbatim.' : '- Article items: return the corrected "topic" string only.'}
Reply with ONLY a JSON array: [{"n":<n>, ${isNl?'"topic":"...","bullet1":"...","bullet2":"...","bullet3":"...","secondaryTopic":"..." (or null)':'"topic":"..."'}}]

ITEMS:
${JSON.stringify(items, null, 1)}`, 6000)
    let fixes = []
    try { fixes = parseJson(fixText) } catch (e) { say(`WARN fix-parse ${vs[0].calName}: ${e.message}`); continue }
    for (const f of fixes) {
      const v = vs[f.n]
      if (!v) continue
      if (existingTitles.has((f.topic||'').toLowerCase())) { say(`WARN duplicate replacement skipped: ${f.topic}`); continue }
      changes.push({ v, fix: f })
    }
    await sleep(800)
  }

  // ---------- apply ----------
  say(`\nApplying ${changes.length} changes…`)
  for (const { v, fix } of changes) {
    if (v.kind === 'article') {
      await prisma.articleCalendarTopic.update({ where: { id: v.row.id }, data: { topic: fix.topic } })
      say(`ARTICLE [${v.calName}] ${v.row.date}\n  - ${v.row.text}\n  + ${fix.topic}\n  (${v.reason})`)
    } else {
      await prisma.newsletterTopic.update({ where: { id: v.row.id }, data: {
        topic: fix.topic, bullet1: fix.bullet1, bullet2: fix.bullet2, bullet3: fix.bullet3,
        secondaryTopic: fix.secondaryTopic ?? null,
        research: null, researchStatus: 'pending',
      } })
      say(`NEWSLETTER [${v.calName}] ${v.row.date}${v.row.fields.draftedAt ? ' (WAS DRAFTED — check)' : ''}\n  - ${v.row.fields.topic}\n  + ${fix.topic}\n  (${v.reason})`)
    }
  }

  // typo fix
  const typo = nCals.find(c => c.name.includes('Nothern'))
  if (typo) {
    await prisma.newsletterCalendar.update({ where: { id: typo.id }, data: { name: typo.name.replace('Nothern','Northern') } })
    say(`RENAMED: "${typo.name}" -> "${typo.name.replace('Nothern','Northern')}"`)
  }

  // ---------- verify ----------
  let residual = 0
  for (const w of work) {
    if (!w.cal.hemisphere) continue
    const table = w.kind === 'article' ? prisma.articleCalendarTopic : prisma.newsletterTopic
    const rows = w.kind === 'article'
      ? await prisma.articleCalendarTopic.findMany({ where:{calendarId:w.cal.id}, select:{date:true, topic:true} })
      : await prisma.newsletterTopic.findMany({ where:{calendarId:w.cal.id}, select:{date:true, topic:true, bullet1:true, bullet2:true, bullet3:true, secondaryTopic:true} })
    for (const r of rows) {
      const txt = w.kind === 'article' ? r.topic : [r.topic,r.bullet1,r.bullet2,r.bullet3,r.secondaryTopic].filter(Boolean).join(' · ')
      const h = heuristic(r.date.toISOString(), txt, w.cal.hemisphere)
      if (h) { residual++; say(`RESIDUAL [${w.cal.name}] ${r.date.toISOString().slice(0,10)} [${h}] ${txt.slice(0,100)}`) }
    }
  }
  say(`\nDONE. changes=${changes.length}, residual-heuristic-flags=${residual}`)
  fs.writeFileSync(OUT+'/changelog.txt', log.join('\n'))
  await prisma.$disconnect()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
