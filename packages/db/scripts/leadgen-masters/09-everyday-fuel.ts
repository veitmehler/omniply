/** Wellness master 09 — Everyday Fuel (Age Check pillar: fuel).
 * Claims discipline (policy 2026-10-20 rule 5): general eating HABITS only,
 * structure/function-safe language, zero supplement or product claims. */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

export const spec: MasterDocSpec = {
  title: 'Everyday Fuel',
  subtitle: 'Unglamorous eating habits that support training, energy, and busy weeks, with zero rules you will hate',
  coverChecklist: [
    'The half-plate habit that replaces calorie math',
    'Hydration without the gallon-jug theatrics',
    'Caffeine and alcohol: honest timing, not prohibition',
    'Meal rhythm: why when you eat shapes how you feel',
  ],
  introHtml:
    "<p>Food advice has a volume problem. Every week brings a new villain, a new miracle, and a new reason to feel behind. Meanwhile the people who feel consistently good tend to do a handful of deeply boring things, repeated for years.</p><p>This guide is those boring things. No forbidden foods, no tracking apps, no moral categories. Just the everyday fuel habits that support training, steady energy, and a busy calendar... each one small enough to start this week and keep through the holidays.</p>",
  blocks: [
    { kind: 'part', title: 'The plate' },
    {
      kind: 'section',
      heading: 'The half-plate habit',
      slotName: 'half_plate',
      unnumbered: true,
      defaultHtml:
        '<p>Forget counting anything. At lunch and dinner, aim for half the plate to be vegetables or salad, a palm of protein, and the rest whatever carbohydrate the meal was built on. That single picture quietly handles fibre, protein, and portion at once, with no app involved.</p><p>Protein deserves one extra sentence: it is what muscles are rebuilt from, and most people eat the bulk of theirs at dinner. Spreading it across the day, some at every meal, supports the strength work in this guide series far better than one big evening dose.</p>',
      frozenHtml:
        '<ul><li><strong>Half the plate:</strong> vegetables or salad, any kind, cooked or raw, frozen counts</li><li><strong>A palm of protein:</strong> fish, meat, eggs, dairy, tofu, beans and lentils all qualify</li><li><strong>The rest:</strong> rice, potatoes, pasta, bread... the meal&rsquo;s foundation, not its enemy</li><li><strong>Shortcut shopping list:</strong> if most of your trolley has one ingredient per item, the week sorts itself</li></ul>',
      tipHtml:
        'Batch one thing on Sunday, not everything: a tray of roast vegetables or a pot of grains. One prepped component makes five fast weeknight plates possible.',
    },
    { kind: 'part', title: 'The liquids' },
    {
      kind: 'section',
      heading: 'Hydration without theatrics',
      slotName: 'hydration',
      unnumbered: true,
      defaultHtml:
        '<p>You do not need a gallon jug with motivational time stamps. You need water to be the default drink, available where you actually sit, and a little extra around training and hot days. Pale-straw urine is the only dashboard most people need.</p>',
      frozenHtml:
        '<ul><li><strong>Anchor it:</strong> a full glass with each meal, and a bottle that lives on your desk</li><li><strong>Training days:</strong> drink beforehand, sip during, and have a glass with the next meal after</li><li><strong>Hot climates and heavy sweaters:</strong> add a pinch more salt with food on big-sweat days; your plate usually covers it</li><li><strong>Bored of water:</strong> sparkling, iced tea without sugar, or fruit slices in the jug all count</li></ul>',
    },
    {
      kind: 'section',
      heading: 'Caffeine and alcohol: timing over prohibition',
      slotName: 'caffeine_alcohol',
      unnumbered: true,
      defaultHtml:
        '<p>Neither needs to disappear; both reward honesty about timing. Caffeine has a half-life of five to six hours, so the 4 pm coffee is still a quarter in your system at ten at night, quietly shaving depth off your sleep. Making lunchtime the usual cut-off keeps the ritual and returns the nights.</p><p>Alcohol is the more honest trade-off: it relaxes the evening and taxes the night, fragmenting sleep in the second half and dulling the next morning... which is exactly when training and good food choices get skipped. Most people feel the difference from two small changes: alcohol-free weeknights as the default, and the last drink earlier rather than smaller.</p>',
    },
    { kind: 'part', title: 'The rhythm', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'When you eat shapes how you feel',
      slotName: 'rhythm',
      unnumbered: true,
      defaultHtml:
        '<p>Bodies love a rhythm in food for the same reason they love one in sleep. Regular meals keep energy steadier than the skip-then-raid pattern, and an earlier, lighter dinner is one of the most underrated sleep habits there is: a body busy digesting at midnight is not fully resting.</p>',
      frozenHtml:
        '<ul><li><strong>Breakfast that includes protein</strong> blunts the mid-morning snack hunt</li><li><strong>Lunch away from the screen,</strong> even 15 minutes... digestion and the afternoon brain both improve</li><li><strong>Dinner roughly three hours before bed</strong> when the calendar allows; a light snack later is fine</li><li><strong>The skipped-meal trap:</strong> missing lunch usually gets repaid, with interest, at 9 pm in front of the pantry</li></ul>',
      tipHtml:
        'Travel weeks and party seasons: do not chase perfect, chase the very next meal. One good plate is always available, and the rhythm restarts there.',
    },
    { kind: 'part', title: 'An honest note' },
    {
      kind: 'section',
      heading: 'What this guide is not',
      slotName: 'honest_note',
      unnumbered: true,
      defaultHtml:
        '<p>These are general habits for generally healthy adults, and that is all they claim to be. They are not a diet, not medical nutrition advice, and not a substitute for personalised guidance.</p>',
      frozenHtml:
        '<ul><li>If you have a diagnosed condition that involves food, your doctor or an accredited dietitian leads, and this guide follows</li><li>If eating feels stressful, controlling, or guilt-laden, that deserves real professional support, not another set of rules</li><li>If you are considering supplements, talk to a qualified professional about what, if anything, fits your situation... this guide deliberately makes no supplement recommendations</li></ul><p>Everyone else: pick the one habit above that feels easiest, run it for two weeks, and let boring do its quiet work.</p>',
    },
  ],
  offerHeadline: 'Want these habits shaped around your training week?',
  disclaimerHtml: wellnessDisclaimer('Everyday Fuel'),
}
