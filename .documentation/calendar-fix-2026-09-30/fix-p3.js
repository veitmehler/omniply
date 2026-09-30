const { PrismaClient } = require('/app/node_modules/@prisma/client')
;(async () => {
  const prisma = new PrismaClient()
  async function calId(model, name) {
    const c = await prisma[model].findFirst({ where: { name }, select: { id: true } })
    if (!c) throw new Error('calendar not found: ' + name)
    return c.id
  }
  async function fixArticle(calName, date, expectOld, newTopic) {
    const id = await calId('articleCalendar', calName)
    const row = await prisma.articleCalendarTopic.findFirst({ where: { calendarId: id, date: new Date(date) } })
    if (!row) { console.log(`MISS ${calName} ${date}`); return }
    if (row.topic !== expectOld) { console.log(`SKIP (changed?) ${calName} ${date}: "${row.topic}"`); return }
    await prisma.articleCalendarTopic.update({ where: { id: row.id }, data: { topic: newTopic } })
    console.log(`FIXED ${calName} ${date}\n  - ${expectOld}\n  + ${newTopic}`)
  }
  // Healthy Aging Northern
  await fixArticle('2026 - Chiro - Healthy Aging - Northern', '2027-11-23T00:00:00Z',
    'New Year Movement Goals That Respect Six Decades of History',
    'Pre-Winter Movement Goals That Respect Six Decades of History')
  await fixArticle('2026 - Chiro - Healthy Aging - Northern', '2026-10-20T00:00:00Z',
    'Thanksgiving Standing Shifts: Kitchen Marathon Management',
    'Canning and Baking Season: Kitchen Marathon Management')
  await fixArticle('2026 - Chiro - Healthy Aging - Northern', '2026-11-26T00:00:00Z',
    'Winter Solstice Movement: Honoring the Darkest Day Actively',
    'Early Dusk Movement: Staying Active as the Days Grow Short')
  await fixArticle('2026 - Chiro - Healthy Aging - Northern', '2027-09-07T00:00:00Z',
    'Halloween on the Porch: Hosting Trick-or-Treat Comfortably',
    'Grandparents Day on the Porch: Hosting the Family Comfortably')
  // Prenatal & Pediatric Northern — theme swap: Halloween moves Sept 2 -> Oct 5
  await fixArticle('2026 - Chiro - Prenatal & Pediatric - Northern', '2027-09-02T00:00:00Z',
    'Halloween While Pregnant: Costumes, Comfort and Candy Walks',
    'Back-to-School Season While Pregnant: Comfort in the Carpool Line')
  await fixArticle('2026 - Chiro - Prenatal & Pediatric - Northern', '2027-10-05T00:00:00Z',
    'Black Friday With a Baby Registry: Gear That Serves Bodies',
    'Halloween While Pregnant: Costumes, Comfort and Candy Walks')
  // NL Sports Southern — midyear review at Jan 4 -> new-year review
  const nid = await calId('newsletterCalendar', '2026 - Chiro NL - Sports - Southern')
  const nrow = await prisma.newsletterTopic.findFirst({ where: { calendarId: nid, date: new Date('2027-01-04T00:00:00Z') } })
  if (nrow && nrow.topic === 'The midyear training review') {
    await prisma.newsletterTopic.update({ where: { id: nrow.id }, data: {
      topic: 'The new-year training review', research: null, researchStatus: 'pending' } })
    console.log(`FIXED NL Sports Southern 2027-01-04\n  - The midyear training review\n  + The new-year training review`)
  } else console.log('NL row state:', nrow ? nrow.topic : 'missing')
  await prisma.$disconnect()
  console.log('P3 DONE')
})().catch(e => { console.error('FATAL', e.message.slice(0,300)); process.exit(1) })
