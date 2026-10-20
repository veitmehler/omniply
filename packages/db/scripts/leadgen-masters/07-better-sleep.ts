/** Wellness master 07 — Better Sleep, Night After Night (Age Check pillar: sleep). */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

export const spec: MasterDocSpec = {
  title: 'Better Sleep, Night After Night',
  subtitle: 'How consistency, light, and a real wind-down turn ordinary nights into your best recovery tool',
  coverAsset: 'w7_cover',
  coverChecklist: [
    'Why a steady sleep schedule beats extra hours',
    'The light rules: morning sun in, evening glow down',
    'A bedroom setup that does half the work for you',
    'The 60-minute wind-down that tells your body the day is over',
  ],
  introHtml:
    "<p>Sleep is the one recovery session nobody can skip, outsource, or compress. It is when muscles rebuild, the day's stress chemistry settles, and tomorrow's energy gets banked. Yet most of us treat it as whatever time is left over once everything else is done.</p><p>The encouraging news: sleep responds to habits faster than almost anything else in this guide series. Most people feel a difference within one to two weeks of changing three things... when they sleep, what light they get, and how the last hour of the day runs.</p><p>No gadgets required. Here is the whole system.</p>",
  blocks: [
    { kind: 'part', title: 'Rhythm first' },
    {
      kind: 'section',
      heading: 'Same time, every day: the anchor habit',
      slotName: 'rhythm',
      unnumbered: true,
      defaultHtml:
        '<p>Your body runs on an internal clock, and that clock loves predictability. A consistent wake-up time, kept even on weekends, is the single most powerful sleep habit there is, because everything else in the cycle sets itself relative to it.</p><p>If your schedule drifts late on weekends and snaps back on Monday, you are giving yourself a small dose of jet lag every single week. That Monday fog has a timetable, not a mystery.</p>',
      tipHtml:
        'Pick your wake time first and count backward to find your bedtime. Protect the wake time ruthlessly; let the bedtime be a strong suggestion. Within two weeks, sleepiness starts arriving on schedule.',
    },
    { kind: 'part', title: 'Light' },
    {
      kind: 'section',
      heading: 'Morning sun in, evening glow down',
      slotName: 'light',
      unnumbered: true,
      figure: { asset: 'w7_light' },
      defaultHtml:
        '<p>Light is the clock-setter. Bright outdoor light within an hour of waking tells your body the day has started, which is exactly what makes sleepiness show up on time that night. Even a cloudy sky outdoors delivers far more useful light than any bright kitchen.</p><p>In the evening the same system runs in reverse: bright overhead light and glowing screens tell your body it is still afternoon. Dim the house after dinner, switch to lamps, and let the last hour run warm and low.</p>',
      frozenHtml:
        '<ul><li><strong>Morning:</strong> 10 to 20 minutes outdoors soon after waking... a walk, a coffee on the step, watering the garden all count</li><li><strong>Daytime:</strong> work near a window when you can; take at least one daylight break</li><li><strong>Evening:</strong> lamps over ceiling lights after dinner; screens dim or away in the final hour</li><li><strong>Night:</strong> if you get up, keep lights as low as safely possible</li></ul>',
    },
    { kind: 'part', title: 'The room' },
    {
      kind: 'section',
      heading: 'A bedroom that does half the work',
      slotName: 'bedroom',
      unnumbered: true,
      defaultHtml:
        '<p>You can white-knuckle good habits in a bad environment for about a week. A good environment works every night without willpower. Three levers matter most: cool, dark, and quiet.</p>',
      frozenHtml:
        "<ul><li><strong>Cool:</strong> around 18&nbsp;&deg;C / 65&nbsp;&deg;F suits most sleepers; in hot climates, airflow and breathable bedding do the same job</li><li><strong>Dark:</strong> blockout curtains or a comfortable eye mask; cover or remove glowing standby lights</li><li><strong>Quiet:</strong> earplugs or steady background sound beat unpredictable noise</li><li><strong>Phone:</strong> charging outside the bedroom is the cheapest sleep upgrade on this list</li><li><strong>Bed = sleep:</strong> work, scrolling, and difficult conversations live better anywhere else</li></ul>",
    },
    { kind: 'part', title: 'The wind-down', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The 60-minute landing pattern',
      slotName: 'winddown',
      unnumbered: true,
      figure: { asset: 'w7_winddown' },
      defaultHtml:
        '<p>Bodies do not have an off switch; they have a descent. A repeatable final hour tells your nervous system, in its own language, that the day is over. The exact contents matter less than the repetition... the routine itself becomes the signal.</p>',
      frozenHtml:
        '<ul><li><strong>60 minutes out:</strong> screens dim or down, tomorrow&rsquo;s list written so your head can put it down</li><li><strong>45 minutes out:</strong> a warm shower or bath; the cool-down afterwards is a natural sleep signal</li><li><strong>30 minutes out:</strong> something genuinely quiet... reading, gentle stretching, slow breathing, or simply unhurried tidying</li><li><strong>At lights out:</strong> if sleep has not arrived after about 20 minutes, get up, keep lights low, read something dull, and return when drowsy</li></ul>',
      tipHtml:
        'Caffeine has a half-life of five to six hours. If nights are restless, make lunchtime the cut-off for a week and watch what happens. Alcohol is the other quiet saboteur: it starts sleep faster but fragments the second half of the night.',
    },
    { kind: 'part', title: 'An honest note' },
    {
      kind: 'section',
      heading: 'When tired is more than tired',
      slotName: 'honest_note',
      unnumbered: true,
      defaultHtml:
        '<p>Habits fix most ordinary sleep problems. They do not fix everything. If you have kept a steady schedule, sorted light and room, and run the wind-down for two to three weeks and nights are still a struggle, it is worth a conversation with a qualified professional rather than more willpower.</p>',
      frozenHtml:
        '<ul><li>Loud snoring with pauses in breathing that someone else has noticed</li><li>Regularly waking unrefreshed no matter how long you sleep</li><li>Legs that will not settle at night</li><li>Daytime sleepiness that affects driving or work</li></ul><p>None of these are habit problems, and all of them deserve professional attention. Getting them checked is the strong move, not the defeated one.</p>',
    },
  ],
  offerHeadline: 'Want help building a sleep-first weekly routine?',
  disclaimerHtml: wellnessDisclaimer('Better Sleep, Night After Night'),
}
