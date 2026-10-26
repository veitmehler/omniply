/** Wellness master 07 — The Sleep Upgrade (resilience rework 2026-10-26;
 *  pillar: sleep; slug stays better-sleep-guide). Beyond-the-basics register:
 *  the reader already keeps a schedule. Starring service: PEMF as wind-down;
 *  temperature + light as the under-used levers; honest sleep-data section. */
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
</table>`

export const spec: MasterDocSpec = {
  title: 'The Sleep Upgrade',
  subtitle: 'Beyond the schedule: temperature, light, the wind-down hour, and what your sleep data actually means',
  coverAsset: 'w7_cover',
  coverChecklist: [
    'Why a steady schedule is necessary but not sufficient',
    'Temperature and light: the two levers most people never pull',
    'The wind-down hour, engineered: breath, stillness, PEMF',
    'How to read sleep-staging numbers without being fooled by them',
  ],
  introHtml:
    "<p>You know the rules. Keep a schedule, skip the late espresso, put the phone away. If you are reading this, you probably follow most of them, and some mornings are still rough. That is because the famous rules cover the timing of sleep, and timing is only one of its inputs.</p><p>This guide is about the inputs after the schedule: the physical conditions your body uses to decide how deep the night gets, and the honest story about the technology around sleep, from recovery studios to the tracker on your wrist.</p><p><strong>The one-sentence version:</strong> sleep is when your body does its repair work, and you can engineer the conditions that let it work deeper.</p>",
  blocks: [
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
        'The cheapest sleep upgrade in this guide costs nothing: tomorrow, get outside within an hour of waking, even for five minutes. The clock that runs your nights is set in the morning.',
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
        'Why we label things this way, including our own tools: a studio that calls everything a miracle is selling. The honest map is the useful one.',
    },
    { kind: 'part', title: 'Your 30-day experiment' },
    {
      kind: 'section',
      heading: 'One month, one lever',
      slotName: 'experiment',
      unnumbered: true,
      defaultHtml: '<p>Pick exactly one lever from this guide and pull it for 30 days.</p>',
      frozenHtml:
        '<p>The candidates: the cool bedroom, the morning light walk, the engineered wind-down hour, or a weekly studio wind-down session. Track two things each morning: your thirty-second pulse and one word for how you woke: fresh, normal, groggy. After 30 days, retake your Body Resilience Score and watch what the sleep input did. One month, one lever, your own data.</p>',
    },
    {
      kind: 'section',
      heading: 'If you want a second pair of eyes',
      slotName: 'close',
      unnumbered: true,
      defaultHtml:
        '<p>If your mornings stay rough no matter which lever you pull, bring your notes to us. A first visit walks through your evenings as they actually are, not as an app thinks they should be, and finds the one change your nights are waiting for.</p>',
    },
  ],
  disclaimerHtml: wellnessDisclaimer('The Sleep Upgrade'),
}
