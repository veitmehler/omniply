/** Pass 4: adjudicated fragment-surgery fixes (year-tail drift + southern
 *  absolute-holiday artifacts). Each op: locate row by calendar+date,
 *  apply find→replace on the offending fragment; MISS/NOMATCH logged. */
const { PrismaClient } = require('/app/node_modules/@prisma/client')
const A='article', N='newsletter'
// [kind, calendarName, date, [[find, replace], ...]]
const OPS = [
  [A,'2026 - Chiro - Family Care - Northern','2027-07-01',[['Starting the Year with Better Posture','A Mid-Year Posture Reset for the Family']]],
  [A,'2026 - Chiro - Sports - Southern','2027-04-15',[['Halloween Fun Runs With Kids: Costumes Meet Cadence','Autumn Fun Runs With Kids: Cool Mornings Meet Cadence']]],
  [A,'2026 - Chiro - Sports - Southern','2028-04-04',[['The Other Season Starting in September','The Other Season on Your Sofa']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Northern','2027-07-06',[['August Baby Boom','Summer Baby Boom']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Northern','2028-04-18',[["Father's Day Feature: ",'']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Northern','2028-04-20',[['Beach Days','Park Days']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Northern','2028-04-25',[['Summer Pregnancy Hydration','Spring Pregnancy Hydration']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Northern','2028-07-20',[['Apple-Picking Pregnant','Berry-Picking Pregnant'],['Orchard Outings','Farm-Stand Outings']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2027-03-16',[['Halloween While Pregnant: Costumes, Comfort and Candy Walks','School-Fair Season While Pregnant: Comfort, Crowds and Long Walks']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-02-22',[['Halloween While Pregnant: Costumes, Comfort and Candy Walks','School-Fair Season While Pregnant: Comfort, Crowds and Long Walks']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2027-03-18',[["The Crawler's Halloween: Baby-Proofing the Decoration Season","The Crawler's Big World: Baby-Proofing Room by Room"]]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-02-24',[["The Crawler's Halloween: Baby-Proofing the Decoration Season","The Crawler's Big World: Baby-Proofing Room by Room"]]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2027-04-08',[['Thanksgiving Hosting','Family-Gathering Hosting']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-03-16',[['Thanksgiving Hosting','Family-Gathering Hosting']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-04-04',[['Holiday Flight Guide','Long-Haul Flight Guide']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-04-06',[['First Winter Illness Season','First Cold-and-Flu Season']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-04-13',[['Holiday Prep in Late Pregnancy','Nursery Prep in Late Pregnancy']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-04-18',[["Baby's First Holidays","Baby's First Family Gatherings"]]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-04-27',[['Winter Babywearing','Cool-Weather Babywearing']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-06-01',[['in January','in Winter']]],
  [A,'2026 - Chiro - Prenatal & Pediatric - Southern','2028-06-20',[['Valentine','Midwinter']]],
  [A,'2026 - Chiro - Healthy Aging - Northern','2028-06-15',[['After Stroke of Midnight','at the Halfway Mark of the Year']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2027-04-20',[['Strength as Thanksgiving','Strength as Gratitude']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2028-03-23',[['Strength as Thanksgiving','Strength as Gratitude']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2027-05-13',[['Winter Solstice Movement: Honoring the Darkest Day Actively','Early Dusk Movement: Staying Active as the Days Grow Short']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2028-04-04',[['Early Winter Swimming','Indoor-Pool Swimming']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2028-04-06',[['Decking Halls','Reaching High Shelves']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2028-04-13',[['Gift-Wrap Ergonomics','Craft-Table Ergonomics']]],
  [A,'2026 - Chiro - Healthy Aging - Southern','2028-05-30',[['Snow Shoveling','Wet-Weather Yard Work'],['Shoveling','Heavy Garden Work']]],
  [A,'2026 - Chiro - Wellness & Maintenance - Southern','2027-10-26',[['The Solstice Audit','The Daylight Audit']]],
  [A,'2026 - Chiro - Wellness & Maintenance - Southern','2028-03-14',[['A Thanksgiving Tradition','A Gratitude Ritual']]],
  [A,'2026 - Chiro - Wellness & Maintenance - Southern','2028-07-06',[['Clock Changes','Shorter Days']]],
  [A,'2026 - Chiro - Wellness & Maintenance - Northern','2027-08-31',[['Winterizing','Autumn-Proofing']]],
  [A,'2026 - Chiro - Wellness & Maintenance - Northern','2028-06-15',[['Late Summer Heat','Early Summer Heat']]],
  [N,'2026 - Chiro NL - Prenatal & Pediatric - Southern','2027-04-03',[['Halloween with a bump','Fancy-dress season with a bump'],['Trick-or-treat walking budgets','Party-night walking budgets'],['Halloween','fancy-dress'],['trick-or-treat','party-night']]],
  [N,'2026 - Chiro - Family Care - Southern','2026-10-03',[['planting spring bulbs','tending spring garden beds']]],
]
;(async () => {
  const prisma = new PrismaClient()
  const calIds = {}
  async function cid(kind, name) {
    const key = kind+name
    if (calIds[key]) return calIds[key]
    const model = kind===A ? prisma.articleCalendar : prisma.newsletterCalendar
    const c = await model.findFirst({ where:{name}, select:{id:true} })
    if (!c) throw new Error('cal not found: '+name)
    return (calIds[key] = c.id)
  }
  let ok=0, miss=0
  for (const [kind, cal, date, subs] of OPS) {
    const id = await cid(kind, cal)
    if (kind === A) {
      const row = await prisma.articleCalendarTopic.findFirst({ where:{calendarId:id, date:new Date(date+'T00:00:00Z')} })
      if (!row) { console.log(`MISS ${cal} ${date}`); miss++; continue }
      let t = row.topic, hit = false
      for (const [f,r] of subs) if (t.includes(f)) { t = t.split(f).join(r); hit = true; break }
      if (!hit) { console.log(`NOMATCH ${cal} ${date}: "${row.topic}"`); miss++; continue }
      await prisma.articleCalendarTopic.update({ where:{id:row.id}, data:{topic:t} })
      console.log(`FIXED ${cal} ${date}\n  - ${row.topic}\n  + ${t}`); ok++
    } else {
      const row = await prisma.newsletterTopic.findFirst({ where:{calendarId:id, date:new Date(date+'T00:00:00Z')} })
      if (!row) { console.log(`MISS NL ${cal} ${date}`); miss++; continue }
      const data = {}
      let hit = false
      for (const field of ['topic','bullet1','bullet2','bullet3','secondaryTopic']) {
        let v = row[field]
        if (!v) continue
        for (const [f,r] of subs) if (v.includes(f)) { v = v.split(f).join(r); hit = true }
        if (v !== row[field]) data[field] = v
      }
      if (!hit) { console.log(`NOMATCH NL ${cal} ${date}: "${row.topic}"`); miss++; continue }
      data.research = null; data.researchStatus = 'pending'
      await prisma.newsletterTopic.update({ where:{id:row.id}, data })
      console.log(`FIXED NL ${cal} ${date}\n  - ${row.topic}\n  + ${data.topic ?? row.topic} (fields: ${Object.keys(data).join(',')})`); ok++
    }
  }
  console.log(`P4 DONE ok=${ok} miss=${miss}`)
  await prisma.$disconnect()
})().catch(e => { console.error('FATAL', e.message.slice(0,300)); process.exit(1) })
