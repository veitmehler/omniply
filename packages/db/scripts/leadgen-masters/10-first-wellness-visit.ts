/** Wellness master 10 — What to Expect at Your First Visit (not quiz-matched;
 *  offered on the Age Check results page, mirroring chiro master 05).
 *  Dasha repositioning 2026-11-02 (Veit-triaged): first visit = TASTER DAY
 *  (day pass): guided reset sequence ice bath → vibration → PEMF →
 *  compression, ~3h, ends in an ORIENTATION CHAT with "the practitioner"
 *  (never a named person — what happens when she is not there, Veit) that is
 *  pointers-not-consultation (protects Rule-1 posture + the paid consult).
 *  NO PRICES in lead-gen documents (Veit rule): price lives on site/bot. */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

const mythsTable = `<table>
<tr><th>Myth</th><th>Fact</th></tr>
<tr><td>"Recovery studios are only for athletes."</td><td>Athletes made these tools famous, but most studio members are ordinary people managing busy lives: desk workers, parents, travelers, people in their 50s and beyond who want to stay capable. The tools do not check your resume at the door.</td></tr>
<tr><td>"One session will change everything."</td><td>A first session usually feels pleasant, and that is all a single session has to be. What people value builds over weeks of routine, the same way one gym visit is not a fitness plan. An honest studio talks about rhythm, not miracles.</td></tr>
<tr><td>"It is all hype."</td><td>The honest answer is: it varies by tool. Some pillars of recovery (movement, sleep, massage) are backed by decades of research; some newer modalities have promising but still-developing evidence. A trustworthy studio will tell you which is which instead of promising outcomes, and this guide encourages you to ask exactly that.</td></tr>
<tr><td>"You have to buy a big package before you know if you like it."</td><td>A good studio lets you try, explains the options, and revisits the plan with you. Treat heavy pressure to pre-pay for months on day one as information about the studio, not about you.</td></tr>
<tr><td>"It will be intense or uncomfortable."</td><td>Most recovery sessions are closer to a rest than a workout, and every setting (pressure, temperature, duration, intensity) can be adjusted. Nothing happens without your okay, and you can pause or stop any session at any time.</td></tr>
<tr><td>"Wellness means skipping the doctor."</td><td>Recovery and wellness work alongside your medical care, never instead of it. A responsible studio asks about your health history and medications before certain sessions, and encourages you to keep your doctor in the loop. If a studio positions itself as a replacement for medical care, walk away.</td></tr>
</table>`

export const spec: MasterDocSpec = {
  title: 'What to Expect at Your First Visit',
  subtitle: 'The taster day: try the tools yourself, feel a guided reset station by station, and walk in relaxed',
  coverAsset: 'w10_cover',
  coverChecklist: [
    'In a hurry? A five-minute version up front',
    'The taster day: one visit, the main tools, no commitment',
    'A guided reset sequence, station by station, strong start to soft landing',
    'What each tool feels like, in plain terms',
    'Six myths, and the questions worth asking any studio',
  ],
  introHtml:
    "<p>The best way to understand a recovery and wellness studio is not a tour, a brochure or a sales chat. It is a day pass: one unhurried visit where you try the main tools yourself, guided the whole way, and feel what your nervous system does with a few hours it rarely gets.</p><p>This guide walks you through that taster day station by station, describes what each tool feels like from the inside, clears up the myths, and arms you with the questions that help you judge any studio for yourself.</p><p><strong>The one-sentence version:</strong> your first visit is a guided reset sequence through the main tools, ending with a short conversation about what fits your goals, and nothing happens without your understanding and consent.</p>",
  blocks: [
    { kind: 'part', title: 'The five-minute version', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Busy? Start here',
      slotName: 'tldr',
      unnumbered: true,
      defaultHtml:
        '<p>Everything in this guide, in five steps. The rest of the pages explain what each station feels like. Read on when you want the detail; you do not need it to book.</p>',
      frozenHtml:
        '<ol><li><strong>Book a day pass,</strong> on our website or with the front desk. Comfortable clothes, water, swimwear if you want the ice bath.</li><li><strong>Take the Body Resilience Score beforehand,</strong> the two-minute self-assessment on our website, so the closing conversation starts from your numbers.</li><li><strong>Plan about three hours:</strong> a guided reset sequence through the main stations, strong start, soft landing, unhurried between.</li><li><strong>Finish with a short orientation chat</strong> with the practitioner: which services fit your goals, in the center and beyond it. Pointers, not a medical consultation.</li><li><strong>Decide nothing on day one.</strong> The day pass is the whole commitment; if a rhythm makes sense afterward, you will know.</li></ol>',
    },
    { kind: 'part', title: 'The taster day', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The reset sequence, station by station',
      slotName: 'walkthrough',
      unnumbered: true,
      figure: { asset: 'w10_timeline' },
      defaultHtml:
        '<p>Plan about three hours in all, with warm-up, changeovers and no clock-watching between stations. The sequence is built like a wave: a strong, wake-everything-up start, then progressively softer stations until your nervous system lands somewhere it rarely gets to go on a weekday.</p>',
      frozenHtml:
        '<ol><li><strong>Ice bath (2 to 5 minutes).</strong> The strong, honest start. The first ninety seconds are the price, easy breathing is the goal, and the exit is always yours. Afterward comes the glow everyone talks about.</li><li><strong>Vibration plate (about 10 minutes).</strong> You stand or move gently while the platform wakes your muscles with rapid contractions you could not produce on purpose. Circulation up, stiffness down.</li><li><strong>PEMF mat (20 to 30 minutes).</strong> You lie down. Some people feel a gentle pulse, many feel nothing at all and simply rest. This is where the descent starts.</li><li><strong>Compression boots (20 to 30 minutes).</strong> The soft landing: rhythmic waves squeeze from the feet upward while you lie back. A remarkable number of people fall asleep here, which is the point.</li><li><strong>The orientation chat (10 to 15 minutes).</strong> You sit down with the practitioner and talk through what you noticed, which services fit your goals, and what could help outside the center too. Pointers, not a medical consultation, and no pressure to decide anything.</li></ol>',
    },
    {
      kind: 'section',
      heading: 'What to wear and bring',
      slotName: 'bring',
      unnumbered: true,
      defaultHtml: '<p>No special preparation needed. These four things make the visit smoother:</p>',
      frozenHtml:
        '<ul><li>Comfortable clothes you can move and relax in (for most sessions you stay dressed)</li><li>A list of medical conditions and medications, if any; some sessions (like oxygen chambers or band training) come with a short safety screening, and that screening is a sign of a good studio</li><li>Water, swimwear and a towel for the ice bath, and a change of clothes for heat and water-based sessions</li><li>Your questions; the end of this guide gives you a ready-made list</li></ul>',
    },
    { kind: 'part', title: 'The tools', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'What does each one actually feel like?',
      slotName: 'modality_feel',
      unnumbered: true,
      figure: { asset: 'w10_feels' },
      defaultHtml:
        '<p>Every studio has its own mix of tools, and your studio will explain why people use each one. Here is what the most common sessions feel like from the inside, so none of it is a surprise:</p>',
      frozenHtml:
        '<ul><li><strong>Oxygen chamber (HBOT):</strong> you sit or lie in a chamber while the pressure gently rises. Your ears pop like on a plane, you equalize the same way, and then... not much. Most people read or nap. Sessions typically run 60 to 90 minutes.</li><li><strong>PEMF mat:</strong> you lie on a padded mat. Some people feel a gentle pulsing or tingling; many feel nothing at all and simply rest. Usually 20 to 30 minutes.</li><li><strong>Compression boots:</strong> sleeve-like boots inflate and deflate around your legs in waves, like a firm, rhythmic squeeze. Most people find it deeply relaxing. Around 20 to 30 minutes.</li><li><strong>Massage and bodywork:</strong> the familiar one. Pressure, focus areas and duration are your call, and saying "lighter, please" is always allowed.</li><li><strong>Band training (KAATSU or blood flow restriction):</strong> light, easy movements while snug bands sit on your arms or legs. The surprise is how quickly muscles feel worked from very light effort. Always guided by trained staff, always preceded by a screening chat.</li><li><strong>Heat and cold (sauna, cold plunge):</strong> short, strong, honest sensations. Time and temperature are adjustable, nothing is a test of toughness, and both are always optional.</li></ul>',
    },
    { kind: 'part', title: 'Sorting fact from fiction', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Six myths, six facts',
      slotName: 'myths',
      unnumbered: true,
      defaultHtml:
        "<p>These six beliefs keep more people out of studios than price ever does. Here's how they hold up:</p>",
      frozenHtml: mythsTable,
    },
    { kind: 'part', title: 'Be an empowered visitor', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Questions worth asking, and answers worth hearing',
      slotName: 'questions',
      unnumbered: true,
      defaultHtml:
        '<p>Any good studio will welcome these. Treat hesitation, vagueness, or pressure as information:</p>',
      frozenHtml:
        `<ul><li><strong>"Who will guide my sessions, and what is their training?"</strong> You should hear specifics, not just enthusiasm.</li><li><strong>"What would make a session not right for me today?"</strong> A good studio asks about conditions, medications, pregnancy, recent surgery, and ear or sinus issues before the relevant sessions. If nobody screens you for anything, that is a red flag, not a convenience.</li><li><strong>"What does the evidence say about this tool?"</strong> The trustworthy answer distinguishes well-established from promising-but-emerging, and never promises outcomes.</li><li><strong>"Can I try before committing to a package?"</strong> The right answer is yes, with a plan revisited as you go.</li><li><strong>"How does this fit with what I do outside the studio?"</strong> Good guidance always connects sessions to your sleep, movement, stress and fuel; the studio visit is a supplement to those, never a substitute.</li></ul>`,
    },
    {
      kind: 'section',
      heading: 'Is it safe?',
      slotName: 'safety',
      unnumbered: true,
      defaultHtml:
        '<p>Bottom line: you now know more about a first studio visit than most people ever do walking in. The door is not a commitment. It is a conversation.</p>',
      frozenHtml:
        '<p>Most recovery sessions are non-invasive and gentle, and the most common after-effect is feeling relaxed or pleasantly tired. The safety of your visit rests on two honest conversations: the studio asking about your health history, medications, pregnancy, recent surgery, and ear or sinus issues before the relevant sessions, and you answering openly. Keep your doctor in the loop about what you are doing, especially if you manage a medical condition, and remember that any session can be paused or stopped the moment something does not feel right.</p>',
    },
  ],
  ctaParagraphHtml:
    'If this guide resonates, book a day pass. One visit, the main tools, a short orientation chat at the end, and nothing to decide on day one.',
  disclaimerHtml: wellnessDisclaimer('What to Expect at Your First Visit'),
}
