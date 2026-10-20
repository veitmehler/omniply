/** Wellness master 08 — The Art of Switching Off (Age Check pillar: unwind). */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

export const spec: MasterDocSpec = {
  title: 'The Art of Switching Off',
  subtitle: 'Why downtime is a skill, not a reward, and how busy people build it back into the week',
  coverAsset: 'w8_cover',
  coverChecklist: [
    'The case for downtime: why rest is part of performance, not its opposite',
    'Micro-pauses: two-minute resets that fit between meetings',
    'The digital sunset: ending the workday on purpose',
    'One protected hour a week, and how to defend it',
  ],
  introHtml:
    "<p>Most busy people treat downtime as what is left after everything important is done. The problem: nothing is ever done. So rest becomes the one appointment that always gets cancelled, and the body keeps score... shoulders that live near your ears, a jaw that aches by Friday, sleep that will not quite land.</p><p>Here is the reframe this guide is built on: switching off is a skill. Like any skill it has techniques, it improves with practice, and it was never supposed to depend on willpower alone. Athletes plan recovery as seriously as training. The rest of us can borrow the idea.</p>",
  blocks: [
    { kind: 'part', title: 'The case' },
    {
      kind: 'section',
      heading: 'Rest is part of the work',
      slotName: 'case_for_rest',
      unnumbered: true,
      defaultHtml:
        '<p>Your stress system was designed for short emergencies, not for a calendar that never closes. When the pressure never fully switches off, the body stays subtly braced: tense muscles, shallow breathing, a mind that rereads the same page three times.</p><p>Deliberate downtime is how the system resets. People who build it in do not get less done; they tend to get more done, with fewer of the Friday-night crashes. The goal of this guide is not less ambition. It is a nervous system that gets to stand down between rounds.</p>',
      tipHtml:
        'A quick self-check: drop your shoulders right now. If they had somewhere to go, your body was carrying tension you had stopped noticing. That is the signal this guide works on.',
    },
    { kind: 'part', title: 'During the day' },
    {
      kind: 'section',
      heading: 'Micro-pauses: the two-minute reset',
      slotName: 'micro_pauses',
      unnumbered: true,
      figure: { asset: 'w8_exhale' },
      defaultHtml:
        '<p>You do not need an empty afternoon to switch off. You need small, repeatable pauses that interrupt the build-up before it compounds. Two minutes, done several times a day, outperforms one heroic spa day a quarter.</p>',
      frozenHtml:
        '<ul><li><strong>The long exhale:</strong> breathe in for four counts, out for six to eight. Six slow rounds. The extended exhale is the fastest calm-down lever you own.</li><li><strong>The window reset:</strong> stand, look at something far away for 60 seconds, roll your shoulders. Eyes and neck relax together.</li><li><strong>The transition walk:</strong> two minutes of walking between tasks, without the phone. Let one thing end before the next begins.</li><li><strong>The single-task cup:</strong> drink one coffee or tea while doing absolutely nothing else. It is harder, and better, than it sounds.</li></ul>',
    },
    { kind: 'part', title: 'Ending the day' },
    {
      kind: 'section',
      heading: 'The digital sunset',
      slotName: 'digital_sunset',
      unnumbered: true,
      figure: { asset: 'w8_sunset' },
      defaultHtml:
        '<p>Work used to end when you left the building. Now it ends only when you decide it does, which means many days never end at all. A digital sunset is a chosen time when the working day is declared over, marked by a small closing ritual your brain learns to trust.</p>',
      frozenHtml:
        '<ul><li><strong>Pick the time</strong> and tell the people who need to know. Consistency makes it believable, to them and to you.</li><li><strong>Write the handover note to tomorrow-you:</strong> three lines on where things stand and what is first. Open loops are what keep the mind at work.</li><li><strong>Close the lid, physically.</strong> Laptop shut, work apps off the home screen, notifications silenced until morning.</li><li><strong>Cross a threshold:</strong> get changed, step outside, put music on. Any small act that says the evening has started.</li></ul>',
      tipHtml:
        'Working from home? The commute used to do the switching for you. Replace it with a fake one: a ten-minute walk around the block at closing time, out the door as if leaving, back in as if arriving home.',
    },
    { kind: 'part', title: 'The weekly anchor', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'One protected hour',
      slotName: 'protected_hour',
      unnumbered: true,
      defaultHtml:
        '<p>Daily pauses keep the pressure from compounding. A weekly anchor goes deeper: one hour, same time each week, that belongs to switching off and nothing else. Put it in the calendar like a meeting, because it is one... with the person who has to carry the rest of your week.</p><p>What fills the hour matters less than its protection. A long walk without headphones. A bath and a book. A float, a massage, a quiet hour somewhere phones do not follow. People who keep a standing quiet hour describe the same thing: the week starts organizing itself around the recovery, instead of recovery scavenging whatever the week leaves behind.</p>',
      frozenHtml:
        '<ul><li><strong>Book it recurring,</strong> not week by week. Decisions made once survive busy seasons.</li><li><strong>Defend it out loud:</strong> "I have something on" is a complete sentence.</li><li><strong>Phone stays behind</strong> or goes to airplane mode. Half-present does not count.</li><li><strong>If it gets cancelled,</strong> it gets rescheduled the same week... that is the whole rule.</li></ul>',
    },
    { kind: 'part', title: 'An honest note' },
    {
      kind: 'section',
      heading: 'When stress will not shift',
      slotName: 'honest_note',
      unnumbered: true,
      defaultHtml:
        '<p>Habits handle everyday pressure remarkably well. Some seasons are heavier than habits. If you have practiced the pauses, kept the sunset, and protected the hour for a few weeks and still feel flat, wired, or close to the edge most days, that is information, not failure.</p>',
      frozenHtml:
        '<ul><li>Sleep that stays broken despite a calm evening routine</li><li>Dread that arrives every morning, not just before big days</li><li>Losing interest in things that normally recharge you</li><li>Leaning harder on alcohol or late-night scrolling to come down</li></ul><p>Those patterns deserve a conversation with a qualified professional: your doctor, a psychologist, or a counsellor. Asking early is the competent move, exactly like seeing a physio before a niggle becomes an injury.</p>',
    },
  ],
  offerHeadline: 'Want a standing quiet hour on someone else’s calendar too?',
  disclaimerHtml: wellnessDisclaimer('The Art of Switching Off'),
}
