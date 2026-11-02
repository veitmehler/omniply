/** Wellness master 07 — The Sleep Upgrade (resilience rework 2026-10-26;
 *  pillar: sleep; slug stays better-sleep-guide). Beyond-the-basics register:
 *  the reader already keeps a schedule. Starring service: PEMF as wind-down;
 *  temperature + light as the under-used levers; honest sleep-data section.
 *  Dasha review 2026-11-02 (her own protocol, triaged w/ Veit): CAR/morning-
 *  light opener, ten-point hygiene checklist, 3 a.m. protocol; wifi = strong
 *  practice w/ contested-evidence note, garlic/honey = Traditional-systems
 *  label, supplements = consult pitch, calming audio kept generic (no NuCalm
 *  brand in the shared master). */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

const evidenceTable = `<table>
<tr><th>Tool or practice</th><th>Evidence status</th><th>Fair summary</th></tr>
<tr><td>Consistent sleep and wake times</td><td>Established</td><td>Still the heavyweight champion. Everything else builds on it.</td></tr>
<tr><td>Cool bedroom and warm-before-bed routine</td><td>Established</td><td>The core body temperature drop is one of the best-documented sleep triggers there is.</td></tr>
<tr><td>Morning bright light, dim evenings</td><td>Established</td><td>Light timing is the master clock input; the research is deep and consistent.</td></tr>
<tr><td>Slow breathing before bed</td><td>Promising</td><td>Consistent small studies on falling asleep faster and calmer nights.</td></tr>
<tr><td>PEMF as a wind-down session</td><td>Exploratory</td><td>Mixed research on the field itself; the scheduled half hour of enforced stillness is beyond dispute.</td></tr>
<tr><td>Sleep-stage numbers from wearables</td><td>Use with care</td><td>Good at trends, rough at single nights; treat the weekly pattern as signal and any one night as noise.</td></tr>
<tr><td>Wifi-free, device-free bedroom</td><td>Contested, zero cost</td><td>Independent studies report measurable effects of wireless signals on sleeping brains; regulatory reviews remain unconvinced. The practice costs nothing and stands on its own.</td></tr>
<tr><td>Glycine and magnesium at night</td><td>Promising, status-dependent</td><td>Small trials support glycine; magnesium helps when you are low, which is testable. A consultation beats a guess.</td></tr>
<tr><td>Calming audio and binaural beats</td><td>Exploratory</td><td>Pleasant and harmless; the wind-down ritual it anchors does the heavy lifting.</td></tr>
<tr><td>Late garlic, evening honey</td><td>Traditional systems</td><td>Ayurveda and Chinese medicine have classed garlic as activating for thousands of years; the honey spoon is folk practice with a plausible mechanism. Cheap, low risk, honestly labeled.</td></tr>
</table>
<p style="font-size:15px;color:#5b6673"><strong>How to read the labels:</strong> Established means repeatedly shown in controlled studies on people. Promising means consistent results in smaller or short-term human studies. Exploratory and contested mean the research is early or the findings are disputed: we say which. Traditional systems means a practice carried by Ayurveda, Chinese medicine or folk tradition rather than modern trials: we label it as such and let you weigh it.</p>`

export const spec: MasterDocSpec = {
  title: 'The Sleep Upgrade',
  subtitle: 'Beyond the schedule: temperature, light, the wind-down hour, and what your sleep data actually means',
  coverAsset: 'w7_cover',
  coverChecklist: [
    'In a hurry? A five-minute version up front',
    'Why tonight starts with how you wake up',
    'Sleep hygiene: the ten-point checklist',
    'The wind-down hour, engineered: breath, stillness, PEMF',
    'The 3 a.m. protocol for the middle of the night',
  ],
  introHtml:
    "<p>You know the rules. Keep a schedule, skip the late espresso, put the phone away. If you are reading this, you probably follow most of them, and some mornings are still rough. That is because the famous rules cover the timing of sleep, and timing is only one of its inputs.</p><p>Here is the part the famous rules skip: tonight starts with how you wake up. In the first half hour of your morning, your body releases a pulse of cortisol, the cortisol awakening response, that winds the day's clock. Sunlight in your eyes soon after waking, before the first screen, anchors that clock; the same brightness from a phone at midnight pushes it the wrong way. Light timing is the master input of your circadian rhythm, and every lever in this guide works better once it is set.</p><p><strong>The one-sentence version:</strong> sleep is when your body does its repair work, you can engineer the conditions that let it work deeper, and the engineering starts at sunrise.</p>",
  blocks: [
    { kind: 'part', title: 'The five-minute version', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Busy? Start here',
      slotName: 'tldr',
      unnumbered: true,
      defaultHtml:
        '<p>Everything in this guide, in five steps. The rest of the pages explain why each one works. Read on when you want the reasoning; you do not need it to start.</p>',
      frozenHtml:
        "<ol><li><strong>Get sunlight in your eyes within an hour of waking,</strong> before the first screen. Tonight's sleep clock is set this morning.</li><li><strong>Run the ten-point sleep hygiene checklist tonight:</strong> cool, dark, wifi off, devices out, warm shower, and the rest on the checklist page.</li><li><strong>Engineer a wind-down hour:</strong> write tomorrow's list down, slow the breath, end in stillness.</li><li><strong>Wake at 3 a.m.?</strong> Red light only, calming audio, long exhales, and the circling thought goes on paper.</li><li><strong>Track your mornings for 30 days</strong> (thirty-second pulse plus one word for how you woke), then retake the Body Resilience Score, the two-minute self-assessment on our website, and compare.</li></ol>",
    },
    { kind: 'part', title: 'The levers after the schedule', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Temperature: the trigger hiding in plain sight',
      slotName: 'temperature',
      unnumbered: true,
      figure: { asset: 'w7_light' },
      defaultHtml:
        '<p>Falling asleep is, physiologically, a cooling event. Your core temperature drops about a degree as sleep begins, and the body reads that drop as the signal to descend. You can work with this instead of against it: a cool bedroom, lighter covers than feel intuitive, and the counterintuitive classic, warming yourself before bed. A warm shower or a sauna session pushes blood to the skin, which is exactly how the core sheds heat afterward. Warm up to cool down.</p>',
      frozenHtml:
        '<ul><li><strong>Bedroom:</strong> cooler than feels cozy, usually 18 to 20 degrees Celsius, 64 to 68 Fahrenheit.</li><li><strong>Before bed:</strong> a warm shower 60 to 90 minutes out, or heat and sauna earlier in the evening.</li><li><strong>Light:</strong> bright and outdoors in the first hour of your morning, dim and warm in the last hour of your evening. Light timing sets the master clock that decides when the temperature drop even becomes available.</li></ul>',
      tipHtml:
        'Warm up to cool down: the shower works because of the heat your skin sheds afterward, not the heat itself.',
    },
    { kind: 'part', title: 'Sleep hygiene', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The ten-point checklist',
      slotName: 'hygiene',
      unnumbered: true,
      defaultHtml:
        '<p>Hygiene is the unglamorous word for the conditions your bedroom hands your body every night. Most of these take one evening to set up and zero discipline afterward, which is the best kind of sleep advice.</p>',
      frozenHtml:
        "<ol><li><strong>Cool room.</strong> 18 to 20 degrees Celsius, 64 to 68 Fahrenheit; cooler than feels cozy.</li><li><strong>Dark room.</strong> Warm and dim in the last hour, lights off at night; blackout if streetlight leaks in.</li><li><strong>Wifi off.</strong> Independent studies have reported measurable effects of wireless signals on sleeping brains, while regulatory reviews remain unconvinced. You do not need that argument settled: switching the router off overnight costs nothing, risks nothing, and can only help.</li><li><strong>Devices out of the bedroom.</strong> The phone charges in another room. Screens keep the mind in the day, and the temptation leaves with them.</li><li><strong>Warm shower, 60 to 90 minutes before bed.</strong> Warming the skin is how the core sheds heat; warm up to cool down.</li><li><strong>Ask about glycine and magnesium.</strong> Both have real research behind them at night, and whether they will do anything for you depends on your status, which is testable. A consultation beats a guess.</li><li><strong>Calming audio.</strong> A wind-down or binaural-beats program, played low, tells the nervous system the day is over.</li><li><strong>No late news.</strong> Nothing that stresses the system in the last hour; the mind you take to bed is the mind you sleep with.</li><li><strong>Easy on late garlic.</strong> Ayurveda and Chinese medicine, written traditions thousands of years old, class garlic as activating to the mind, and heavy, pungent food late at night is hard on digestion in any tradition. Enjoy it at lunch.</li><li><strong>Prone to waking in the middle of the night?</strong> A small spoonful of real honey before you brush your teeth is a tradition many of our sleepers swear by. The rationale: the fructose in honey preferentially restocks the liver's overnight fuel store, the buffer your blood sugar draws on while you sleep. Trial data is thin, as cheap, unpatentable remedies rarely attract funded studies, but the cost is one spoon and the risk next to zero.</li></ol>",
    },
    { kind: 'part', title: 'The wind-down hour' },
    {
      kind: 'section',
      heading: 'Engineering the descent',
      slotName: 'winddown',
      unnumbered: true,
      figure: { asset: 'w7_winddown' },
      defaultHtml:
        '<p>Your body does not have an off switch. It has a descent, and the hour before bed decides how steep it gets. The goal of a wind-down hour is not discipline, it is removing the things that keep the system revved: bright light, open loops, one more scroll.</p>',
      frozenHtml:
        '<ul><li><strong>Minute 0 to 20: close the loops.</strong> The to-do list for tomorrow gets written down, not carried to bed. Two minutes of writing beats an hour of ceiling-staring.</li><li><strong>Minute 20 to 40: slow the breath.</strong> Longer exhales than inhales, through the nose, no app required. Slow breathing is the one relaxation practice with consistently promising research behind it, and it costs nothing.</li><li><strong>Minute 40 to 60: stillness, by any means.</strong> Reading on paper, stretching on the floor, or, if your studio has one, a PEMF session: lying on the mat, feeling a faint pulse or nothing at all, with your only job being to stay horizontal. The honest science note: research on the field itself is mixed, and we label it that way. The half hour of enforced, screen-free stillness it schedules is not mixed at all. Many members use it exactly this way: the wind-down hour, outsourced.</li></ul>',
    },
    { kind: 'part', title: 'The 3 a.m. protocol' },
    {
      kind: 'section',
      heading: 'If you wake in the middle of the night',
      slotName: 'nightwake',
      unnumbered: true,
      defaultHtml:
        '<p>Everyone wakes at night sometimes. What decides whether it costs you the rest of the night is what happens in the next ten minutes.</p>',
      frozenHtml:
        '<ol><li><strong>Keep the light red and low.</strong> A red motion-sensor night light in the bathroom means you never blast the clock with bright light at 3 a.m.</li><li><strong>Put calming audio on.</strong> A binaural-beats or wind-down track, played low.</li><li><strong>Breathe with longer exhales.</strong> In through the nose, out slower than in; the long exhale is the body\'s own brake.</li><li><strong>If sleep will not return, read.</strong> A paper book, warm light, nothing gripping.</li><li><strong>Write the loop down.</strong> If a thought keeps circling, put it on paper. Out of the head, onto the page, and the rumination habit starves.</li></ol>',
    },
    { kind: 'part', title: 'What the numbers mean', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Reading sleep data without being fooled',
      slotName: 'data',
      unnumbered: true,
      defaultHtml:
        '<p>If you wear a tracker, you have seen the morning verdicts: deep sleep minutes, REM percentages, a readiness score. Here is how to use them without letting them use you.</p>',
      frozenHtml:
        '<ul><li><strong>Trust trends, not nights.</strong> Wrist devices estimate sleep stages from movement and heart rhythm, and against laboratory measurement they are decent at totals and rough at stages. A single bad-looking night is noise. Three weeks of drift is signal.</li><li><strong>Watch the morning, not the screen.</strong> Your resting pulse and how you feel in the first ten minutes awake track recovery as well as most dashboards.</li><li><strong>Never chase a score at bedtime.</strong> Worrying about sleep data in bed is the one proven way to make it worse. If the tracker stresses you, the tracker sleeps in another room.</li></ul>',
    },
    {
      kind: 'section',
      heading: 'Every lever in this guide, placed honestly',
      slotName: 'evidence',
      unnumbered: true,
      defaultHtml: '<p>Here is where everything above actually stands:</p>',
      frozenHtml: evidenceTable,
      tipHtml:
        'These are the same labels we apply when we decide what earns a place in your evening.',
    },
    { kind: 'part', title: 'Your 30-day experiment' },
    {
      kind: 'section',
      heading: 'One month, one lever',
      slotName: 'experiment',
      unnumbered: true,
      defaultHtml: '<p>Pick exactly one lever from this guide and pull it for 30 days.</p>',
      frozenHtml:
        '<p>The candidates: the morning light walk, the cool bedroom, the full hygiene checklist, the engineered wind-down hour, or a weekly studio wind-down session. Track two things each morning: your thirty-second pulse and one word for how you woke: fresh, normal, groggy. After 30 days, retake the Body Resilience Score, the two-minute self-assessment on our website, and watch what the sleep input did. One month, one lever, your own data.</p>',
    },
    {
      kind: 'section',
      heading: 'If you want a second pair of eyes',
      slotName: 'close',
      unnumbered: true,
      defaultHtml:
        '<p>If your mornings stay rough no matter which lever you pull, book a consultation and bring your notes. We will walk through your evenings as they actually are, not as an app thinks they should be, and find the one change your nights are waiting for.</p>',
    },
  ],
  ctaParagraphHtml:
    'If this guide resonates, book a consultation. We will walk through your evenings and your mornings, and find the one change your nights are waiting for.',
  disclaimerHtml: wellnessDisclaimer('The Sleep Upgrade'),
}
