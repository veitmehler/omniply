/** Wellness master 06 — Bounce Back Stronger (resilience rework 2026-10-26;
 *  pillar: move; slug stays everyday-strength-guide). Register approved in
 *  the Phase 1 packet: respect-the-basics opening, mechanism-first, honest
 *  evidence table (incl. the studio's own tools), 30-day self-experiment.
 *  Starring service: the Recovery package (WBV + compression + PEMF) + BFR;
 *  HBOT gets a supporting recovery section (Dasha: stem-cell research + the
 *  longevity reputation, evidence-labeled). */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

const evidenceTable = `<table>
<tr><th>Tool or practice</th><th>Evidence status</th><th>Fair summary</th></tr>
<tr><td>Strength training</td><td>Established</td><td>The foundation. Decades of research, every age group.</td></tr>
<tr><td>BFR light-load training</td><td>Established for muscle with light loads</td><td>Well studied in rehabilitation and healthy adults; heavy lifting still wins for maximal strength.</td></tr>
<tr><td>Compression therapy</td><td>Promising</td><td>Consistent findings on soreness and perceived recovery.</td></tr>
<tr><td>Whole-body vibration</td><td>Promising</td><td>Good short-term effects on flexibility and circulation; the long-term performance picture is still forming.</td></tr>
<tr><td>PEMF</td><td>Exploratory</td><td>Long research history, mixed results; the scheduled rest is a sure thing.</td></tr>
<tr><td>Hyperbaric oxygen for recovery</td><td>Exploratory</td><td>Researchers have measured interesting markers, including circulating stem cells, in small studies; performance claims outrun the data, so we will not make them.</td></tr>
</table>`

export const spec: MasterDocSpec = {
  title: 'Bounce Back Stronger',
  subtitle: 'How to get back to full capacity fast: for people who already train and want the part nobody taught them',
  coverAsset: 'w6_cover',
  coverChecklist: [
    'Why your results are capped by recovery, not effort',
    'The smarter load: hard muscle work without heavy joints (BFR)',
    'The recovery stack: vibration, compression and PEMF, honestly explained',
    'A 30-day self-experiment with nothing but a morning pulse',
  ],
  introHtml:
    "<p>You already know the basics. Lift things, move often, do not sit all day. If you are reading this, you have probably known that for years, and you probably do most of it. This guide is about the layer after the basics: what actually happens between one effort and the next, and how the people who keep performing for decades manage that gap on purpose.</p><p>Here is the idea that changes how you train: fitness is not built during exercise. Exercise is the signal. The building happens afterward, while you recover. Which means your results are capped not by how hard you can push, but by how well you bounce back.</p><p><strong>The one-sentence version:</strong> the stress, recover, adapt cycle has three parts, and skipping the middle one means the third never arrives.</p>",
  blocks: [
    { kind: 'part', title: 'Why bounce-back is trainable', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The gap between the curves',
      slotName: 'adaptation',
      unnumbered: true,
      figure: { asset: 'w6_moves' },
      defaultHtml:
        '<p>Picture the day after a hard effort. Two people did the same session. One is back to full capacity by the next morning, a little stronger than before. The other is still dragging on day three. Same stress, two recoveries, and the gap between those curves is not luck or age. It is trainable, and everything in this guide works on it.</p>',
      tipHtml:
        'A baseline you can take today: tomorrow morning, before coffee, take your pulse for thirty seconds. Write it down with one word about how your body feels. That number is about to become useful.',
    },
    { kind: 'part', title: 'The smarter load' },
    {
      kind: 'section',
      heading: 'Hard muscle work without heavy joints',
      slotName: 'bfr',
      unnumbered: true,
      defaultHtml:
        '<p>For decades the rule was simple: to build strength, lift heavy. True, but incomplete, and for plenty of bodies on plenty of days, heavy is not the right answer. Joints complain, schedules interfere, injuries linger.</p><p>This is where blood flow restriction training earns its place. Snug bands sit on the upper arms or legs while you move light loads, often 20 to 30 percent of what you could lift. The bands reduce blood flow out of the working muscle, the muscle environment becomes demanding far sooner than the load suggests, and the fatigue signal that drives adaptation shows up at a fraction of the joint stress. In practice it feels strange and then surprising: two minutes of light work and the muscle is talking to you the way it usually does under something much heavier.</p>',
      frozenHtml:
        '<p>The honest evidence summary: researchers have studied this for years, first in rehabilitation, where loading a healing limb heavily is not an option, and increasingly in healthy adults and older trainees. For building muscle with light loads, the approach is well supported. For maximal strength in trained athletes, heavy lifting still rules. That makes it a tool with a clear job: hard muscle work on days, or in bodies, that should not carry hard loads.</p><p>One rule we do not bend: band pressure and placement are set by someone trained, after a short screening conversation. It is a five-minute chat, and it is the difference between a smart tool and a strange one.</p>',
    },
    { kind: 'part', title: 'The recovery stack', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Three tools, one hour, three different jobs',
      slotName: 'stack',
      unnumbered: true,
      figure: { asset: 'w6_week' },
      defaultHtml:
        '<p>Now the other half of the cycle, the part most training plans leave to chance. A recovery session at a studio typically stacks three tools in about an hour, each doing a different job.</p>',
      frozenHtml:
        '<ul><li><strong>Whole-body vibration</strong> comes first. You stand or move gently on a platform that oscillates many times per second, and your muscles respond with rapid, tiny contractions you could not produce voluntarily. Think of it as waking the tissue up: circulation rises, stiffness eases, movements feel smoother afterward. The research picture is honest and mixed: well supported for short-term flexibility and circulation, still developing for long-term performance. As the opening act of a recovery hour, it earns its ten minutes.</li><li><strong>Compression</strong> is the familiar one with a mechanical upgrade. Sleeve boots inflate and deflate around your legs in waves, squeezing from the feet upward, the same direction your circulation drains. The idea is straightforward plumbing: exercise leaves fluid and metabolic byproducts in the tissue, and rhythmic pressure helps move them along. Athletes describe the feeling as legs that are two hours fresher. The evidence supports reduced soreness and that lighter-legs feeling; it will not rebuild muscle for you, and nobody honest claims it does.</li><li><strong>PEMF</strong> closes the hour, and it is the quietest of the three. You lie on a mat that produces pulsed electromagnetic fields; most people feel a faint rhythm or nothing at all, and a good number simply fall asleep. That tells you what the session is really for: it is a downshift, a scheduled half hour where your nervous system is allowed to idle. The field itself has a long research history with genuinely mixed results, which is exactly how the table below labels it. The enforced rest is not controversial at all.</li></ul>',
    },
    {
      kind: 'section',
      heading: 'The chamber, for recovery',
      slotName: 'hbot_recovery',
      unnumbered: true,
      defaultHtml:
        '<p>You may know hyperbaric oxygen from longevity podcasts. The short version for this guide: you breathe oxygen at raised pressure for about an hour, usually reading or napping, and researchers have measured interesting things afterward in small studies, including a rise in circulating stem cells. Interesting is the right word, and it is as far as the data lets anyone go: the famous studies are small, and performance claims outrun them. What the chamber reliably delivers is the same thing that makes it a deep-rest tool: an hour where your body is off duty. If the recovery stack is your routine, the chamber is the occasional deep service. More on it, including what a session actually feels like, in our guide The Deep Rest Protocol.</p>',
    },
    { kind: 'part', title: 'Reading the evidence like an adult', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Every tool in this guide, placed honestly',
      slotName: 'evidence',
      unnumbered: true,
      defaultHtml:
        '<p>Here is where everything above actually stands:</p>',
      frozenHtml: evidenceTable,
      tipHtml:
        'Why we label our own tools this way: because you should trust the rest of this guide. A studio that calls everything a miracle is selling. A studio that tells you what is established, what is promising and what is still being figured out is the one worth listening to.',
    },
    { kind: 'part', title: 'Your 30-day experiment' },
    {
      kind: 'section',
      heading: 'One month, one variable, your own data',
      slotName: 'experiment',
      unnumbered: true,
      defaultHtml:
        '<p>Do not take our word for any of this. Run the experiment.</p>',
      frozenHtml:
        '<p>Each morning before coffee, take your pulse for thirty seconds and note it with one word about how your body feels: fresh, normal, heavy. That is the whole measurement, no wearable required, though if you own one, its readiness or HRV number works too. Then change exactly one thing for 30 days: add one weekly recovery session, or swap one heavy day for a smarter-load day. Watch what your morning numbers do after hard efforts. Fast bounce-back is visible within days: the morning-after pulse returns to baseline sooner, and the heavy mornings get rarer.</p><p>At the end, retake your Body Resilience Score and compare. One month, one variable, your own data.</p>',
    },
    {
      kind: 'section',
      heading: 'If you want a second pair of eyes',
      slotName: 'close',
      unnumbered: true,
      defaultHtml:
        '<p>If you would rather run that experiment with someone watching the details, that is what we do all day. A first visit walks through how you train, how you recover, and which single change your month should start with. No overhauls, no lectures, and your morning pulse gets the final vote.</p>',
    },
  ],
  disclaimerHtml: wellnessDisclaimer('Bounce Back Stronger'),
}
