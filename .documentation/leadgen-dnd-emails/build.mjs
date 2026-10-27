// Lead-gen delivery emails as drag-and-drop builder templates.
// Usage: node build.mjs wellness   -> creates the 11 wellness templates via API
//        node build.mjs chiro      -> only writes payload files (no PIT yet unless CHIRO_PIT env set)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const core = JSON.parse(readFileSync(join(HERE, 'sample-core.json'), 'utf8'))
const shell = readFileSync(join(HERE, '..', 'dnd-probe', 'sample-preview.html'), 'utf8')

const VERT = process.argv[2]
if (!['wellness', 'chiro'].includes(VERT)) { console.error('usage: node build.mjs wellness|chiro'); process.exit(1) }

const CFG = {
  wellness: {
    locationId: 'dyDcrf5pZnHXVXA7Rhx4',
    pit: process.env.WELLNESS_PIT,
    updatedBy: 'lTefw8DToUcVCLnbObmC',
    links: {
      booking: '2Flk0FJXHq5RbEOymNH3',
      bb: 'rsC5ThFYwshqYiR7g8an',   // everyday-strength -> Bounce Back Stronger
      su: 'tHYxNgnDii9O1QcplA96',   // better-sleep -> The Sleep Upgrade
      dr: '3uCPFzJIJkh1cSDe4IfO',   // switch-off -> The Deep Rest Protocol
      if: 'otRPKVnRG16H3TT4pHv5',   // everyday-fuel -> The Invisible Fuel Layer
      fv: 'GijlVrGSRCKv5AVdviWG',   // first-wellness-visit
    },
  },
  chiro: {
    locationId: 'nTr8IulThJiXAzJXmy9N',
    pit: process.env.CHIRO_PIT,
    updatedBy: 'lTefw8DToUcVCLnbObmC',
    links: {
      booking: '9onZoCYLUzNjNL55yrzN',
      bs: 'e0pShKnY6DUxAFgtjALt',   // better-sleep-without-pills
      dw: 'jlVlnAZ6LDB5bXfp78g5',   // desk-workers-survival-guide
      fv: 'GdwoMDn7FBwCvNwtp7XH',   // first-chiropractic-visit
      mh: 'O2ihsIWTVgerkDFMVJeb',   // morning-habits-spine
      pw: '9kEMfaKp3jgB5Ml27wD1',   // pain-normal-or-warning-sign
    },
  },
}[VERT]

// ---------- content model ----------
const P_STYLE = 'margin: 0px;font-size: 16px;padding-left: 0px !important;font-family: verdana, geneva, sans-serif;'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const para = (text) => `<p style="${P_STYLE}"><span style="font-size: 20px">${text}</span></p>`
const spacer = () => `<p style="${P_STYLE}"></p>`
const linkLine = (linkId, rest) =>
  `<p style="${P_STYLE}"><a target="_blank" rel="noopener noreferrer nofollow" href="{{trigger_link.${linkId}}}" title="Click here &lt;--"><span style="font-size: 20px">Click here &lt;--</span></a><span style="font-size: 20px">${esc(rest)}</span></p>`

function contentHtml(items) {
  const parts = [`<p><span style="font-size: 20px">Hi {{contact.first_name}},</span></p>`]
  for (const it of items) {
    parts.push(spacer())
    parts.push(it.link ? linkLine(CFG.links[it.link], it.rest) : para(esc(it.t)))
  }
  parts.push(spacer(), spacer())
  parts.push(`<p style="${P_STYLE}"><span style="font-size: 20px">{{user.email_signature}}</span></p>`)
  return parts.join('')
}

// delivery skeleton shared by every "Access email"
const delivery = (quotedTitle, linkKey, noun = 'guide') => [
  { t: `Google should have already sent you the link to your "${quotedTitle}" ${noun}.` },
  { t: 'If you missed it, here it is again:' },
  { link: linkKey, rest: ' to access the guide.' },
  { t: "I hope it's already useful." },
  { t: "One question we ask everyone: what made you download it today? Hit reply and tell us, or if you'd rather talk it through in person:" },
  { link: 'booking', rest: ' to schedule an appointment.' },
]

// "Sunday read" opener (genericized: works in every branch)
const sundayOpen = [
  { t: 'Most people read a guide, nod, and change nothing. The ones who get results pick ONE thing and do it for two weeks.' },
  { t: 'So, what did you pick from your guide and implement into your life?' },
  { t: 'Want help choosing the right one for your situation? We are here to help:' },
  { link: 'booking', rest: ' to schedule an appointment.' },
]

const EMAILS = VERT === 'chiro' ? {
  'Guide delivery - Better Sleep Without Pills': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('Better Sleep Without Pills', 'bs') },
  "Guide delivery - Desk Worker's Survival Guide": {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery("Desk Worker's Survival Guide", 'dw') },
  'Guide delivery - First Chiropractic Visit': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('What to Expect at Your First Chiropractic Visit', 'fv') },
  'Guide delivery - 7 Morning Habits': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('7 Morning Habits That Are Wrecking Your Spine', 'mh') },
  'Guide delivery - Pain Normal or Warning Sign': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('Is Your Pain Normal, or a Warning Sign', 'pw', 'report') },
  'Sunday read - First Chiropractic Visit': {
    subject: 'Your guide is here + one quick question', preview: 'Do you know what to expect on your first chiropractic visit?',
    items: [...sundayOpen,
      { t: `Speaking of guides, we have another Sunday read for you; it's called "What to Expect at Your First Chiropractic Visit", in case you don't know what to expect.` },
      { t: `You see, most people put off their first chiropractic visit for one reason: they don't know what to expect. So here's the whole thing, demystified.` },
      { t: `It's the walkthrough of a real first appointment, what that famous sound actually is (and isn't), fact versus fiction, and the questions worth asking so you walk in as an empowered patient rather than a nervous one:` },
      { link: 'fv', rest: ' to download your report.' }] },
  "Sunday read - Desk Worker's Survival Guide": {
    subject: "Your desk is winning. Here's how to fight back.", preview: 'Need to set up your desk properly? Here is how...',
    items: [...sundayOpen,
      { t: `Speaking of guides, we have another Sunday read for you; it's called "Desk Worker's Survival Guide", in case you need to improve your workspace.` },
      { t: `Eight hours in a chair does something quietly relentless to your spine, and the sock you'll blame when your back finally "goes out" had nothing to do with it.` },
      { t: `The Desk Worker's Survival Guide is our field manual for people who can't quit sitting but refuse to accept what it's doing to them: the 6-step desk reset, the posture traps almost everyone falls into, and the ten-minute daily routine that beats an hour of weekend hero stretching.` },
      { link: 'dw', rest: ' to download your report.' }] },
  "Bonus Guide - Desk Worker's Survival Guide": {
    subject: "Your desk is winning. Here's how to fight back.", preview: 'Need to set up your desk properly? Here is how...',
    items: [
      { t: `Eight hours in a chair does something quietly relentless to your spine, and the sock you'll blame when your back finally "goes out" had nothing to do with it.` },
      { t: `The Desk Worker's Survival Guide is our field manual for people who can't quit sitting but refuse to accept what it's doing to them: the 6-step desk reset, the posture traps almost everyone falls into, and the ten-minute daily routine that beats an hour of weekend hero stretching.` },
      { link: 'dw', rest: ' to access the guide.' },
      { t: 'Prefer to have someone look at your sitting situation specifically? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
  'Bonus Guide - Better Sleep Without Pills': {
    subject: 'Tired of being tired?', preview: "Do you wake up feeling you've been hit by a truck? Here's why...",
    items: [
      { t: `If you're waking up stiff, sore, or more exhausted than when you went to bed, the problem often isn't how long you sleep. It's what your body is doing for those eight hours.` },
      { t: `Better Sleep Without Pills covers the position-and-pillow mechanics nobody teaches, the evening routine that helps your body actually downshift, and why your mattress matters less than you've been told.` },
      { link: 'bs', rest: ' to access the guide.' },
      { t: 'Prefer to have someone look at your sleeping situation specifically? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
  'Bonus Guide - Pain Normal or Warning Sign': {
    subject: `"That pain'll go away on its own", or will it?`, preview: 'Did you experience some aches and pain recently?',
    items: [
      { t: 'Some aches genuinely are nothing. Others are your body filing a report nobody reads until it escalates. The tricky part is that the two often feel identical for weeks.' },
      { t: `This guide walks you through the difference: what's usually harmless, what deserves attention, and the handful of signs that mean "stop guessing and get it looked at."` },
      { t: `It's the guide we wish every patient had read a year earlier.` },
      { link: 'pw', rest: ' to access the report.' },
      { t: `Already have a feeling it's the second kind? Trust that feeling. Get it checked out properly:` },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
  'Bonus Guide - 7 Morning Habits': {
    subject: "You're sabotaging your spine before breakfast", preview: 'Feeling tight in the morning? Do this...',
    items: [
      { t: `The first 30 minutes after you wake up set your spine's tone for the whole day, and most of us fill them with a greatest-hits collection of terrible ideas:` },
      { t: 'The phone-check hunch before your feet touch the floor, the toothbrush lean, the car-seat slump with a coffee in one hand.' },
      { t: 'This guide covers the 7 morning habits quietly working against you, and the painless swaps that cost zero extra minutes.' },
      { link: 'mh', rest: ' to access the report.' },
      { t: 'Want a morning routine built around your body instead of a generic list? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
} : {
  'Guide delivery - Bounce Back Stronger': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('Bounce Back Stronger', 'bb') },
  'Guide delivery - The Sleep Upgrade': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('The Sleep Upgrade', 'su') },
  'Guide delivery - The Deep Rest Protocol': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('The Deep Rest Protocol', 'dr') },
  'Guide delivery - The Invisible Fuel Layer': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('The Invisible Fuel Layer', 'if') },
  'Guide delivery - First Visit': {
    subject: 'Your guide is here + one quick question', preview: 'Did you get the link to your guide?',
    items: delivery('What to Expect at Your First Visit', 'fv') },
  'Sunday read - First Visit': {
    subject: 'Your guide is here + one quick question', preview: 'Do you know what to expect on your first visit?',
    items: [...sundayOpen,
      { t: `Speaking of guides, we have another Sunday read for you; it's called "What to Expect at Your First Visit", in case you have been curious about the studio but never walked in.` },
      { t: 'Walking into a recovery and wellness studio for the first time can feel like visiting the future. There are chambers and mats and boots and bands, and it is not obvious what any of them feel like, or whether you are about to be talked into a membership.' },
      { t: 'This guide removes the mystery: the first visit step by step, what the most common tools feel like from the inside, the myths cleared up, and the questions that help you judge any studio for yourself:' },
      { link: 'fv', rest: ' to download your guide.' }] },
  'Sunday read - Bounce Back Stronger': {
    subject: 'Your guide is here + one quick question', preview: 'How fast do you get back to full capacity?',
    items: [...sundayOpen,
      { t: `Speaking of guides, we have another Sunday read for you; it's called "Bounce Back Stronger", our field manual for getting back to full capacity fast.` },
      { t: 'Here is the idea that changes how you train: fitness is not built during exercise. Exercise is the signal. The building happens afterward, while you recover.' },
      { t: 'The guide covers the stress, recover, adapt cycle, the recovery tools worth knowing, and a 30-day experiment to test it on your own body:' },
      { link: 'bb', rest: ' to download your guide.' }] },
  'Bonus Guide - Bounce Back Stronger': {
    subject: 'Your results are capped by your recovery', preview: 'Training hard? The gains happen in between.',
    items: [
      { t: 'You already know the basics. Lift things, move often, do not sit all day. The layer after the basics is what actually happens between one effort and the next.' },
      { t: 'Fitness is not built during exercise. Exercise is the signal. The building happens afterward, while you recover. Your results are capped not by how hard you can push, but by how well you bounce back.' },
      { t: 'Bounce Back Stronger is our field manual for that gap: the stress, recover, adapt cycle, the recovery tools worth knowing, and a 30-day experiment to run on yourself.' },
      { link: 'bb', rest: ' to access the guide.' },
      { t: 'Prefer to have someone look at your recovery specifically? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
  'Bonus Guide - The Sleep Upgrade': {
    subject: 'Tired of being tired?', preview: 'The famous sleep rules cover timing. Timing is only one input.',
    items: [
      { t: 'You know the rules. Keep a schedule, skip the late espresso, put the phone away. If some mornings are still rough, that is because the famous rules cover the timing of sleep, and timing is only one of its inputs.' },
      { t: 'The Sleep Upgrade covers the inputs after the schedule: the physical conditions your body uses to decide how deep the night gets, and the honest story about the technology around sleep, from recovery studios to the tracker on your wrist.' },
      { link: 'su', rest: ' to access the guide.' },
      { t: 'Prefer to have someone look at your sleep specifically? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
  'Bonus Guide - The Deep Rest Protocol': {
    subject: 'Stress is not your enemy', preview: 'The damage comes from what does not happen after.',
    items: [
      { t: 'Stress is just a demand, and bodies are built to meet demands. The damage comes from what happens after, or rather what does not happen: the switch back down.' },
      { t: 'A nervous system that stays revved between demands never does its repair work, and that shows up everywhere, from sleep to patience to how long a sore muscle stays sore.' },
      { t: 'If you are the kind of person who cannot sit still, telling you to relax is useless advice. The Deep Rest Protocol takes the other route: tools and structures that switch you off whether your calendar likes it or not.' },
      { link: 'dr', rest: ' to access the guide.' },
      { t: 'Rather have someone walk you through it in person? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
  'Bonus Guide - The Invisible Fuel Layer': {
    subject: 'Two people eat the same. One recovers faster.', preview: 'Your plate cannot show you your actual status.',
    items: [
      { t: 'You know how to eat. Vegetables, protein, water, not too much of the fun stuff. And yet fueling has a layer your plate cannot show you: your actual status.' },
      { t: 'Two people can eat identically while one runs low on iron and the other carries a mineral burden neither will ever feel directly. They just recover differently and never know why.' },
      { t: 'The Invisible Fuel Layer is about that layer: what runs low, what sneaks in, what the shortcut industry is selling, and the principle that beats all the guessing.' },
      { link: 'if', rest: ' to access the guide.' },
      { t: 'Want to stop guessing about your own status? If so:' },
      { link: 'booking', rest: ' to schedule an appointment.' }] },
}

// ---------- editorData assembly ----------
const rid = () => Array.from({ length: 8 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('')

function buildEditorData(mainContent) {
  const ids = { sec: `mj-section-${rid()}`, col: `mj-column-${rid()}`, pv: `mj-preview-url-${rid()}`, main: `mj-text-${rid()}`, div: `mj-divider-${rid()}`, foot: `mj-text-${rid()}` }
  return {
    elements: [{ id: ids.sec, tagName: 'mj-section', children: [{ id: ids.col, tagName: 'mj-column', children: [
      { id: ids.pv, tagName: 'mj-preview-url' },
      { id: ids.main, tagName: 'mj-text' },
      { id: ids.div, tagName: 'mj-divider' },
      { id: ids.foot, tagName: 'mj-text' },
    ] }] }],
    attrs: {
      [ids.sec]: core.sectionAttrs,
      [ids.col]: core.columnAttrs,
      [ids.pv]: core.previewUrlAttrs,
      [ids.main]: { ...core.mainTextAttrs, content: mainContent },
      [ids.div]: core.dividerAttrs,
      [ids.foot]: core.footerTextAttrs,
    },
    templateSettings: core.templateSettings,
  }
}

// html field: transplant content into the sample's rendered shell
function buildHtml(mainContent) {
  const start = shell.indexOf('<p><span style="font-size: 20px">Hi {{contact.first_name}},')
  const endMarker = '{{user.email_signature}}</div>'
  const end = shell.indexOf(endMarker)
  if (start < 0 || end < 0) throw new Error('shell markers not found')
  return shell.slice(0, start) + mainContent + shell.slice(end + endMarker.length - '</div>'.length)
}

// ---------- API ----------
const BASE = 'https://services.leadconnectorhq.com'
const H = { Authorization: `Bearer ${CFG.pit}`, Version: '2021-07-28', 'Content-Type': 'application/json' }

async function api(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`)
  return j
}

const outDir = join(HERE, `payloads-${VERT}`)
mkdirSync(outDir, { recursive: true })
const results = []

for (const [name, spec] of Object.entries(EMAILS)) {
  const main = contentHtml(spec.items)
  if (/[–—]/.test(main)) throw new Error(`em/en dash in: ${name}`)
  const payload = {
    create: { locationId: CFG.locationId, type: 'builder', builderVersion: '2', name, title: name },
    data: { locationId: CFG.locationId, templateId: null, updatedBy: CFG.updatedBy, editorType: 'builder', previewText: spec.preview, html: buildHtml(main), dnd: buildEditorData(main) },
    subject: spec.subject,
  }
  writeFileSync(join(outDir, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json'), JSON.stringify(payload, null, 1))
  if (CFG.pit) {
    const created = await api('/emails/builder', payload.create)
    payload.data.templateId = created.id || created.redirect
    const saved = await api('/emails/builder/data', payload.data)
    // verify the server's compiler understood the structure
    const stored = await (await fetch(saved.templateDataDownloadUrl)).json()
    const pj = JSON.stringify(stored.previewJson || {})
    const marker = spec.items.find((i) => i.t)?.t.slice(0, 40)
    const ok = pj.includes(JSON.stringify(marker).slice(1, -1))
    results.push({ name, id: payload.data.templateId, compiled: ok })
    console.log(`${ok ? 'OK ' : 'WARN(preview missing marker) '} ${name} -> ${payload.data.templateId}`)
  } else {
    results.push({ name, id: null, compiled: null })
    console.log(`payload written (no PIT): ${name}`)
  }
}
writeFileSync(join(outDir, '_results.json'), JSON.stringify(results, null, 1))
console.log(`\n${results.length} templates ${CFG.pit ? 'created' : 'prepared'} for ${VERT}`)
