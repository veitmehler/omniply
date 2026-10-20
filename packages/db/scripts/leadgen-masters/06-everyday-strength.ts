/** Wellness master 06 — Everyday Strength (Age Check pillar: move). */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

export const spec: MasterDocSpec = {
  title: 'Everyday Strength',
  subtitle: 'The five movements that keep you capable for decades, and a 20-minute week that actually fits your life',
  coverChecklist: [
    'Why muscle is the quiet currency of aging well',
    'The five everyday movements behind almost everything you do',
    'A 20-minute week: two short sessions you will actually keep',
    'Lighter-load options when joints, time, or confidence say no to heavy weights',
  ],
  introHtml:
    "<p>Somewhere between 30 and 40, most of us stop doing the thing our bodies are built around: working against resistance. Not because we decided to, but because life filled up. The result shows slowly... groceries feel heavier, stairs feel longer, the floor gets further away.</p><p>Here is the encouraging part: strength responds to practice at every age. Researchers have documented meaningful strength gains in people starting in their 60s, 70s, and beyond. You do not need a gym membership, an hour a day, or heavy barbells. You need a handful of movements, done regularly, at a dose that fits your week.</p><p>This guide gives you exactly that: the five movements, the simple week, and the lighter-load options for days and decades when heavy is not the answer.</p>",
  blocks: [
    { kind: 'part', title: 'The why' },
    {
      kind: 'section',
      heading: 'Muscle: the quiet currency of aging well',
      slotName: 'why_strength',
      unnumbered: true,
      defaultHtml:
        '<p>From our thirties onward, muscle quietly declines unless we give the body a reason to keep it. That decline is not just about looking strong. Muscle is where you store the capacity for everyday life: carrying a suitcase, getting up off the floor, catching yourself when you trip, playing on the ground with kids and grandkids.</p><p>Healthy-aging conversations keep returning to the same theme: the people who stay capable are rarely the ones who trained hardest in their twenties. They are the ones who never fully stopped. Consistency beats intensity, and it is never too late to restart.</p>',
      tipHtml:
        'A useful self-test you can do today: sit on the floor, then stand back up. Notice how much you used your hands. No score, no judgment... just a baseline to revisit in three months.',
    },
    { kind: 'part', title: 'The five movements' },
    {
      kind: 'section',
      heading: 'Squat, hinge, push, pull, carry',
      slotName: 'five_moves',
      unnumbered: true,
      defaultHtml:
        '<p>Strip away the machines and the jargon and nearly everything your body does against resistance is one of five patterns. Train these five and daily life gets easier almost everywhere at once.</p>',
      frozenHtml:
        '<ul><li><strong>Squat</strong> (sitting down and standing up): start with a sturdy chair. Sit down slowly, stand up without hands. Build to 10 smooth repeats.</li><li><strong>Hinge</strong> (picking things up): push your hips back as if closing a car door with your backside, spine long, knees soft. Practice with a light bag before anything heavy.</li><li><strong>Push</strong> (doors, prams, getting off the floor): wall push-ups first, then a kitchen bench, then the floor. Choose the height where 8 feels doable and 12 feels honest.</li><li><strong>Pull</strong> (bags, ropes, kayak paddles): a resistance band anchored in a door is all you need. Row the band to your ribs, shoulders relaxed, slow on the way back.</li><li><strong>Carry</strong> (groceries, suitcases, grandchildren): take one moderately heavy object for a short walk. Tall posture, easy breathing. Swap sides. That is the whole exercise.</li></ul>',
    },
    { kind: 'part', title: 'The plan' },
    {
      kind: 'section',
      heading: 'The 20-minute week',
      slotName: 'week_plan',
      unnumbered: true,
      defaultHtml:
        '<p>Two sessions of ten minutes beat one heroic hour that never happens. The plan below is deliberately modest, because the goal is December, not just next Tuesday.</p>',
      frozenHtml:
        '<ul><li><strong>Session A (10 minutes):</strong> squats to a chair, wall or bench push-ups, a carry around the house or block. Two relaxed rounds.</li><li><strong>Session B (10 minutes):</strong> hinges with a light bag, band rows, a balance hold by the kitchen bench (30 seconds each side). Two relaxed rounds.</li><li><strong>Progress rule:</strong> when all of a session feels easy for two weeks in a row, add a little weight, a few repeats, or one slower tempo. One change at a time.</li><li><strong>Missed a week?</strong> Restart at the last version that felt easy. Momentum matters more than the number.</li></ul>',
      tipHtml:
        'Anchor each session to something that already happens: after the school run, before the first coffee at your desk, right after the Saturday market. Habits stick to habits.',
    },
    {
      kind: 'section',
      heading: 'When lighter loads make more sense',
      slotName: 'lighter_loads',
      unnumbered: true,
      defaultHtml:
        '<p>Heavy is not the only road to strong. If joints complain, if you are returning after a long break, or if confidence is the barrier, lighter loads done with intent work remarkably well. Slow tempos, higher repeats, and short rests all raise the challenge without raising the weight.</p><p>Some studios and coaches also offer supervised blood-flow restriction training (you may hear it called KAATSU), where soft cuffs let muscles work hard against surprisingly light loads. If that idea appeals, ask about a coached introduction rather than experimenting alone... the coaching is the point.</p>',
    },
    { kind: 'part', title: 'An honest note', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'When to bring in a professional',
      slotName: 'honest_note',
      unnumbered: true,
      defaultHtml:
        '<p>Most people can start this guide today. But a short movement assessment with a physiotherapist or qualified trainer is worth its weight when any of the following are true:</p>',
      frozenHtml:
        '<ul><li>A past injury still changes how you move or makes you hesitant</li><li>Pain shows up during or after the basic movements above</li><li>You have a diagnosed condition and want your plan adapted around it</li><li>You simply want your technique checked before adding load</li></ul><p>Ten minutes of professional eyes on your squat and hinge can save months of guesswork. That is not a sales line; it is how movement professionals themselves start a new program.</p>',
    },
  ],
  offerHeadline: 'Want your technique checked before you add weight?',
  disclaimerHtml: wellnessDisclaimer('Everyday Strength'),
}
