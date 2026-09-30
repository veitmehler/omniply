/** Final deterministic verify + CSV re-export. Accept-list = reviewed calls. */
const fs = require('fs')
const { PrismaClient } = require('/app/node_modules/@prisma/client')
function heuristic(dateStr, text, hemi) {
  const m = parseInt(dateStr.slice(5,7), 10)
  const s = text.toLowerCase()
  const north = hemi !== 'south'
  const winterM = north ? [12,1,2] : [6,7,8]
  const summerM = north ? [6,7,8] : [12,1,2]
  const has = (re) => re.test(s)
  if (winterM.includes(m) && has(/summer|beach day|heatwave|pool season/)) return 'winter-month/summer-text'
  if (summerM.includes(m) && has(/\bwinter\b|snow|chilly|cold outside/)) return 'summer-month/winter-text'
  if (has(/december heat|december sun/) && m !== 12) return 'says-december'
  if (has(/easter/) && ![3,4].includes(m)) return 'easter'
  if (has(/christmas|festive season|celebrating the holidays|holiday stress|post-holiday/) && ![11,12,1].includes(m)) return 'holidays'
  if (has(/mid-year|midyear/) && ![5,6,7].includes(m)) return 'mid-year'
  if (has(/back.to.school/) && !(north ? [8,9] : [1,2]).includes(m)) return 'school'
  if (has(/new year/) && ![12,1].includes(m)) return 'new-year'
  if (has(/thanksgiving/) && ![10,11].includes(m)) return 'thanksgiving'
  if (has(/halloween/) && ![9,10,11].includes(m)) return 'halloween'
  if (has(/solstice/) && ![5,6,11,12].includes(m)) return 'solstice'
  return null
}
function accepted(dateStr, text, hemi) {
  const s = text.toLowerCase()
  const m = parseInt(dateStr.slice(5,7), 10)
  if (/without the winter|without the snow|than summer grass/.test(s)) return true
  if (hemi === 'north' && m === 9 && /september reset|school-year energy/.test(s)) return true
  if (hemi === 'south' && m === 3 && /march reset|school-year energy/.test(s)) return true
  if (/long evening walk|solstice sleep fight|summer solstice audit/.test(s)) return true
  return false
}
const csvq = (x)=>'"'+String(x??'').replace(/"/g,'""')+'"'
;(async () => {
  const prisma = new PrismaClient()
  fs.mkdirSync('/tmp/calfix/export', { recursive: true })
  let flags = 0
  for (const c of await prisma.articleCalendar.findMany({ select:{id:true,name:true,hemisphere:true} })) {
    const rows = await prisma.articleCalendarTopic.findMany({ where:{calendarId:c.id}, orderBy:{date:'asc'}, select:{date:true,topic:true} })
    fs.writeFileSync(`/tmp/calfix/export/${c.name.replace(/[^A-Za-z0-9-]+/g,'_')}.csv`,
      'date,topic\n' + rows.map(r => `${r.date.toISOString().slice(0,10)},${csvq(r.topic)}`).join('\n'))
    if (!c.hemisphere) continue
    for (const r of rows) { const d = r.date.toISOString(); const h = heuristic(d, r.topic, c.hemisphere)
      if (h && !accepted(d, r.topic, c.hemisphere)) { flags++; console.log(`FLAG [${c.name}] ${d.slice(0,10)} [${h}] ${r.topic}`) } }
  }
  for (const c of await prisma.newsletterCalendar.findMany({ select:{id:true,name:true,hemisphere:true} })) {
    const rows = await prisma.newsletterTopic.findMany({ where:{calendarId:c.id}, orderBy:{date:'asc'},
      select:{date:true,topic:true,bullet1:true,bullet2:true,bullet3:true,secondaryTopic:true} })
    fs.writeFileSync(`/tmp/calfix/export/${c.name.replace(/[^A-Za-z0-9-]+/g,'_')}.csv`,
      'date,topic,bullet1,bullet2,bullet3,secondary_topic\n' + rows.map(r =>
        [r.date.toISOString().slice(0,10),csvq(r.topic),csvq(r.bullet1),csvq(r.bullet2),csvq(r.bullet3),csvq(r.secondaryTopic??'')].join(',')).join('\n'))
    if (!c.hemisphere) continue
    for (const r of rows) { const d = r.date.toISOString()
      const txt = [r.topic,r.bullet1,r.bullet2,r.bullet3,r.secondaryTopic].filter(Boolean).join(' · ')
      const h = heuristic(d, txt, c.hemisphere)
      if (h && !accepted(d, txt, c.hemisphere)) { flags++; console.log(`FLAG [${c.name}] ${d.slice(0,10)} [${h}] ${txt.slice(0,100)}`) } }
  }
  console.log(`FINAL flags=${flags}`)
  await prisma.$disconnect()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
