/**
 * Pass 2: repair what pass 1 skipped (own-title duplicate-guard bug) and
 * the imperfect residuals. Guard v2: a replacement topic may equal the
 * row's OWN current topic (bullet-level nl fixes) but never another row's.
 * Documented accepts: intentional seasonal contrasts are not violations.
 */
const fs = require('fs')
const { PrismaClient } = require('/app/node_modules/@prisma/client')
const { getSystemApiKey } = require('/app/dist/lib/system-keys')
const MODEL = 'claude-sonnet-4-5-20250929'
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
  if (has(/mid-year|midyear/) && ![5,6,7].includes(m)) return 'mid-year/wrong-month'
  if (has(/back.to.school/) && !(north ? [8,9] : [1,2]).includes(m)) return 'back-to-school/wrong-month'
  if (has(/new year/) && ![12,1].includes(m)) return 'new-year/wrong-month'
  return null
}
// Reviewed-and-accepted: intentional contrasts / in-season metaphors.
function accepted(dateStr, text, hemi) {
  const s = text.toLowerCase()
  const m = parseInt(dateStr.slice(5,7), 10)
  if (/without the winter|without the snow|than summer grass/.test(s)) return true
  if (hemi === 'north' && m === 9 && /september reset|school-year energy/.test(s)) return true
  if (hemi === 'south' && m === 3 && /march reset|school-year energy/.test(s)) return true
  return false
}
let KEY = null
async function llm(prompt, maxTokens = 6000) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    if (res.ok) { const d = await res.json(); return (d.content?.[0]?.text ?? '').trim() }
    const body = await res.text().catch(() => '')
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 4) { await sleep(20000); continue }
    throw new Error(`anthropic ${res.status}: ${body.slice(0,200)}`)
  }
}
function parseJson(text) {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) throw new Error('no JSON: ' + text.slice(0,150))
  return JSON.parse(m[0])
}

;(async () => {
  const prisma = new PrismaClient()
  KEY = await getSystemApiKey('anthropic')
  const log = []
  const say = (s) => { console.log(s); log.push(s) }

  // Rebuild the current picture per calendar and decide what still needs fixing.
  const targets = [] // {kind, calId, calName, hemi, id, date, current:{...}, reason}
  const calTitles = {} // calId -> Set of lowercase topics
  const aCals = await prisma.articleCalendar.findMany({ select: { id:true, name:true, hemisphere:true } })
  const nCals = await prisma.newsletterCalendar.findMany({ select: { id:true, name:true, hemisphere:true } })
  for (const c of aCals.filter(c => c.hemisphere)) {
    const rows = await prisma.articleCalendarTopic.findMany({ where:{calendarId:c.id}, select:{id:true,date:true,topic:true} })
    calTitles[c.id] = new Map(rows.map(r => [r.topic.toLowerCase(), r.id]))
    for (const r of rows) {
      const d = r.date.toISOString()
      const h = heuristic(d, r.topic, c.hemisphere)
      if (h && !accepted(d, r.topic, c.hemisphere))
        targets.push({ kind:'article', calId:c.id, calName:c.name, hemi:c.hemisphere, id:r.id, date:d.slice(0,10), current:{topic:r.topic}, reason:h })
    }
  }
  for (const c of nCals.filter(c => c.hemisphere)) {
    const rows = await prisma.newsletterTopic.findMany({ where:{calendarId:c.id},
      select:{id:true,date:true,topic:true,bullet1:true,bullet2:true,bullet3:true,secondaryTopic:true} })
    calTitles[c.id] = new Map(rows.map(r => [r.topic.toLowerCase(), r.id]))
    for (const r of rows) {
      const d = r.date.toISOString()
      const txt = [r.topic,r.bullet1,r.bullet2,r.bullet3,r.secondaryTopic].filter(Boolean).join(' · ')
      const h = heuristic(d, txt, c.hemisphere)
      if (h && !accepted(d, txt, c.hemisphere))
        targets.push({ kind:'newsletter', calId:c.id, calName:c.name, hemi:c.hemisphere, id:r.id, date:d.slice(0,10),
          current:{topic:r.topic,bullet1:r.bullet1,bullet2:r.bullet2,bullet3:r.bullet3,secondaryTopic:r.secondaryTopic}, reason:h })
    }
  }
  // Also re-check pass-1 violations whose rows are textually unchanged (LLM-found classes
  // the heuristic can't see: school/sport-season errors).
  const v1 = JSON.parse(fs.readFileSync('/tmp/calfix/violations.json','utf8'))
  for (const v of v1) {
    if (targets.some(t => t.id === v.row.id)) continue
    if (v.kind === 'article') {
      const r = await prisma.articleCalendarTopic.findUnique({ where:{id:v.row.id}, select:{topic:true,date:true} })
      if (r && r.topic === v.row.text)
        targets.push({ kind:'article', calId:v.calId, calName:v.calName, hemi:v.hemi, id:v.row.id, date:v.row.date, current:{topic:r.topic}, reason:v.reason })
    } else {
      const r = await prisma.newsletterTopic.findUnique({ where:{id:v.row.id},
        select:{topic:true,bullet1:true,bullet2:true,bullet3:true,secondaryTopic:true} })
      if (!r) continue
      const txt = [r.topic,r.bullet1,r.bullet2,r.bullet3,r.secondaryTopic].filter(Boolean).join(' · ')
      if (txt === v.row.text && !accepted(v.row.date, txt, v.hemi))
        targets.push({ kind:'newsletter', calId:v.calId, calName:v.calName, hemi:v.hemi, id:v.row.id, date:v.row.date, current:r, reason:v.reason })
    }
  }
  say(`Pass-2 targets: ${targets.length}`)

  // Fix per calendar.
  const byCal = {}
  targets.forEach(t => { (byCal[t.calId] = byCal[t.calId] || []).push(t) })
  let applied = 0
  for (const calId of Object.keys(byCal)) {
    const ts = byCal[calId]
    const isNl = ts[0].kind === 'newsletter'
    const avoid = [...calTitles[calId].keys()]
    const fixText = await llm(
`Fix seasonal/date mismatches in the chiropractic ${isNl?'newsletter':'article'} calendar "${ts[0].calName}" (${ts[0].hemi}ern hemisphere).
Each item: a date, the current content, and the problem. Produce corrected content that clearly FITS that date in this hemisphere (season, holidays, school calendar: ${ts[0].hemi==='north'?'school starts Aug/Sep, summer Jun-Aug':'school starts late Jan/Feb, summer Dec-Feb'}).
- Minimal edits preferred; the corrected text must contain NO leftover wrong-season/wrong-holiday/wrong-month words.
- The "topic" must NOT match any title in the AVOID list below — EXCEPT it may stay identical to the item's own current topic when only the bullets are wrong.
${isNl ? '- Return ALL fields: topic, bullet1, bullet2, bullet3, secondaryTopic (null if none). Edit only what is wrong.' : '- Return "topic" only.'}
Reply ONLY a JSON array: [{"n":<n>, ...fields}]

AVOID TITLES: ${avoid.join(' | ')}

ITEMS:
${JSON.stringify(ts.map((t,i)=>({n:i,date:t.date,problem:t.reason,current:t.current})), null, 1)}`)
    let fixes = []
    try { fixes = parseJson(fixText) } catch (e) { say(`WARN parse ${ts[0].calName}: ${e.message}`); continue }
    for (const f of fixes) {
      const t = ts[f.n]; if (!t || !f.topic) continue
      const ownerOfTitle = calTitles[calId].get(f.topic.toLowerCase())
      if (ownerOfTitle && ownerOfTitle !== t.id) { say(`WARN still-duplicate, skipped: ${f.topic}`); continue }
      // verify the fix passes the heuristic before writing
      const checkTxt = t.kind==='article' ? f.topic : [f.topic,f.bullet1,f.bullet2,f.bullet3,f.secondaryTopic].filter(Boolean).join(' · ')
      const h = heuristic(t.date+'T00:00:00Z', checkTxt, t.hemi)
      if (h && !accepted(t.date, checkTxt, t.hemi)) { say(`WARN fix still flagged (${h}), skipped: ${f.topic}`); continue }
      if (t.kind === 'article') {
        await prisma.articleCalendarTopic.update({ where:{id:t.id}, data:{ topic: f.topic } })
      } else {
        await prisma.newsletterTopic.update({ where:{id:t.id}, data:{
          topic:f.topic, bullet1:f.bullet1 ?? undefined, bullet2:f.bullet2 ?? undefined, bullet3:f.bullet3 ?? undefined,
          secondaryTopic: f.secondaryTopic === undefined ? undefined : f.secondaryTopic,
          research: null, researchStatus: 'pending' } })
      }
      calTitles[calId].set(f.topic.toLowerCase(), t.id)
      applied++
      say(`FIXED [${t.calName}] ${t.date}\n  - ${t.current.topic}\n  + ${f.topic}\n  (${t.reason})`)
    }
    await sleep(600)
  }

  // Final verify.
  let residual = 0
  for (const c of aCals.filter(c=>c.hemisphere)) {
    const rows = await prisma.articleCalendarTopic.findMany({ where:{calendarId:c.id}, select:{date:true,topic:true} })
    for (const r of rows) { const d=r.date.toISOString(); const h=heuristic(d,r.topic,c.hemisphere)
      if (h && !accepted(d,r.topic,c.hemisphere)) { residual++; say(`RESIDUAL [${c.name}] ${d.slice(0,10)} [${h}] ${r.topic}`) } }
  }
  for (const c of nCals.filter(c=>c.hemisphere)) {
    const rows = await prisma.newsletterTopic.findMany({ where:{calendarId:c.id},
      select:{date:true,topic:true,bullet1:true,bullet2:true,bullet3:true,secondaryTopic:true} })
    for (const r of rows) { const d=r.date.toISOString()
      const txt=[r.topic,r.bullet1,r.bullet2,r.bullet3,r.secondaryTopic].filter(Boolean).join(' · ')
      const h=heuristic(d,txt,c.hemisphere)
      if (h && !accepted(d,txt,c.hemisphere)) { residual++; say(`RESIDUAL [${c.name}] ${d.slice(0,10)} [${h}] ${txt.slice(0,110)}`) } }
  }
  say(`\nPASS2 DONE. applied=${applied}, residual=${residual}`)
  fs.writeFileSync('/tmp/calfix/changelog-p2.txt', log.join('\n'))
  await prisma.$disconnect()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
