/** Wellness master 08 — The Deep Rest Protocol (resilience rework
 *  2026-10-26; pillar: unwind; slug stays switch-off-guide). Starring
 *  service: HBOT as the enforced deep-rest hour (Dasha: nervous system +
 *  the stem-cell/longevity reputation, evidence-labeled). Supporting cast:
 *  HRV literacy, breathwork, heat/cold contrast. */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

const evidenceTable = `<table>
<tr><th>Tool or practice</th><th>Evidence status</th><th>Fair summary</th></tr>
<tr><td>Deliberate daily downtime</td><td>Established</td><td>Chronic switched-on stress has decades of documentation; protected recovery time is the antidote with the deepest support.</td></tr>
<tr><td>Slow breathing practices</td><td>Promising</td><td>Consistent small studies on calming the stress response in minutes; essentially free.</td></tr>
<tr><td>Sauna habits</td><td>Promising</td><td>Large observational studies associate regular use with cardiovascular health; relaxing either way.</td></tr>
<tr><td>Cold exposure</td><td>Promising for mood and alertness</td><td>Short-term effects are well documented; long-term claims are younger than the headlines suggest.</td></tr>
<tr><td>HRV as a personal gauge</td><td>Promising</td><td>Useful as your own trend over weeks; meaningless as a comparison to anyone else.</td></tr>
<tr><td>Hyperbaric oxygen</td><td>Exploratory for wellness uses</td><td>Established in hospital medicine for specific conditions; the wellness and longevity findings, including stem-cell and telomere studies, are small and early. The enforced deep-rest hour is beyond dispute.</td></tr>
</table>`

export const spec: MasterDocSpec = {
  title: 'The Deep Rest Protocol',
  subtitle: 'Nervous-system recovery for people who cannot sit still',
  coverAsset: 'w8_cover',
  coverChecklist: [
    'Why being switched on is the real enemy, not stress itself',
    'How to read your own nervous system: HRV and the morning pulse, in plain terms',
    'The enforced-rest hour: what an oxygen chamber session actually is and feels like',
    'Heat, cold and breath: the contrast toolkit, started gently',
  ],
  introHtml:
    "<p>Here is the part the productivity culture got wrong: stress is not your enemy. Stress is just a demand, and bodies are built to meet demands. The damage comes from what happens after, or rather what does not happen: the switch back down. A nervous system that stays revved between demands never does its repair work, and that shows up everywhere, from sleep to patience to how long a sore muscle stays sore.</p><p>If you are the kind of person who cannot sit still, telling you to relax is useless advice. This guide takes the other route: tools and structures that switch you off whether your calendar likes it or not.</p><p><strong>The one-sentence version:</strong> recovery is a skill with equipment, and the skill is trainable.</p>",
  blocks: [
    { kind: 'part', title: 'Reading your own dashboard', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Your nervous system, in two numbers',
      slotName: 'hrv',
      unnumbered: true,
      figure: { asset: 'w8_exhale' },
      defaultHtml:
        '<p>You do not need a lab to see your stress state. Two numbers, both free, tell most of the story.</p>',
      frozenHtml:
        '<ul><li><strong>Morning resting pulse.</strong> Thirty seconds, before coffee. When it drifts up over several days, your system is carrying load it has not put down.</li><li><strong>Heart rate variability, if you own a wearable.</strong> HRV is the tiny variation between heartbeats, and higher generally means a system with room to flex. The two honest rules: compare yourself only to your own baseline, never to anyone else, and read weekly trends, never single mornings. A system under chronic load shows falling HRV across weeks, and that is your cue to take the rest of this guide seriously.</li></ul>',
      tipHtml:
        'The fastest lever in the whole guide: exhale longer than you inhale for two minutes. Slow breathing with long exhales is the rare technique with promising research, zero cost, and effects you can feel the first time.',
    },
    { kind: 'part', title: 'The enforced-rest hour', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The chamber: rest you cannot interrupt',
      slotName: 'hbot',
      unnumbered: true,
      figure: { asset: 'w8_sunset' },
      defaultHtml:
        '<p>For people who cannot sit still, the most effective rest is the kind you cannot get up from. A hyperbaric session is exactly that: you settle into the chamber, the pressure rises gently, your ears pop like on a plane, and for the next hour your only job is to be horizontal. Most people read. A remarkable number simply fall asleep. Phones do not follow you in. For one engineered hour, you are off duty, and no notification can argue.</p>',
      frozenHtml:
        '<p>Now the part you may have heard on longevity podcasts, told honestly. Hyperbaric oxygen is established hospital medicine for specific conditions, and that is not what a wellness session is. On the wellness side, researchers have run small studies measuring things like circulating stem cells and markers associated with cellular aging, with intriguing early results. Intriguing and early are the honest words: the studies are small, replication is young, and anyone promising you regeneration by the hour is ahead of the data. What we can promise is the part nobody disputes: a scheduled hour of deep, uninterruptible rest, which for a switched-on nervous system is precisely the medicine this guide is about. A short screening conversation comes first, covering ears, sinuses and a few conditions, and that screening is a sign of a studio doing it right.</p>',
    },
    { kind: 'part', title: 'The contrast toolkit' },
    {
      kind: 'section',
      heading: 'Heat, cold, and the art of the deliberate shock',
      slotName: 'contrast',
      unnumbered: true,
      defaultHtml:
        '<p>Heat and cold are the oldest nervous-system tools there are, and the modern research is catching up to the tradition. The principle is the same for both: a short, strong, deliberate stress, followed by a clean recovery, teaches the system that it can go up and come back down. That round trip is the exact skill a switched-on system has forgotten.</p>',
      frozenHtml:
        '<ul><li><strong>Heat:</strong> sauna sessions leave most people measurably calmer, and large observational studies associate the regular habit with cardiovascular health. Start with less time than you think you want.</li><li><strong>Cold:</strong> the short-term effects on mood and alertness are well documented, and the first ninety seconds are the honest price. Start warm-ended: cool showers before ice baths, always with easy breathing as the goal.</li><li><strong>The rule for both:</strong> never a toughness contest. Time and temperature are adjustable, and the win is a calm exit, not a dramatic entry.</li></ul>',
    },
    { kind: 'part', title: 'Reading the evidence like an adult', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Every tool in this guide, placed honestly',
      slotName: 'evidence',
      unnumbered: true,
      defaultHtml: '<p>Here is where everything above actually stands:</p>',
      frozenHtml: evidenceTable,
      tipHtml:
        'Why we label our own tools this way, including the famous chamber: a studio that calls everything a miracle is selling. The honest map is the one worth following.',
    },
    { kind: 'part', title: 'Your 30-day experiment' },
    {
      kind: 'section',
      heading: 'One month, one protected hour',
      slotName: 'experiment',
      unnumbered: true,
      defaultHtml:
        '<p>The experiment for this input is the simplest in the series and the hardest to keep: one protected, screen-free hour per week, on the calendar, defended like a meeting.</p>',
      frozenHtml:
        '<p>Fill it however you like: the breath practice, a sauna round, a chamber session, a walk without headphones. Track the same two numbers each morning: the thirty-second pulse and one word for your state. Watch what three or four protected hours do to the weekly trend. Then retake your Body Resilience Score and see what the unwind input says. One month, one hour a week, your own data.</p>',
    },
    {
      kind: 'section',
      heading: 'If you want the hour handed to you',
      slotName: 'close',
      unnumbered: true,
      defaultHtml:
        '<p>If defending an hour against your own calendar sounds like the hard part, that is literally what we are for. A first visit walks through where your weeks leak recovery, and which tool gives you the most switch-off per minute. Some people need a protocol. Some just need a door that closes. We have both.</p>',
    },
  ],
  disclaimerHtml: wellnessDisclaimer('The Deep Rest Protocol'),
}
