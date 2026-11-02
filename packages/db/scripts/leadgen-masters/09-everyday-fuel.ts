/** Wellness master 09 — The Invisible Fuel Layer (resilience rework
 *  2026-10-26; pillar: fuel; slug stays everyday-fuel-guide). PROBLEM-FIRST
 *  per Veit: deficiencies + heavy-metal exposure that harm resilience, the
 *  testing step de-centered from any device; peptide landscape section under
 *  the three locked guardrails (landscape-only, no protocols or dosing,
 *  gray market IS the consult pitch). "Test, do not guess" is the spine. */
import type { MasterDocSpec } from '../../../../apps/api/src/leadgen/master-layout'
import { wellnessDisclaimer } from './common'

const evidenceTable = `<table>
<tr><th>Topic</th><th>Evidence status</th><th>Fair summary</th></tr>
<tr><td>Iron deficiency and fatigue</td><td>Established</td><td>One of the best-documented energy thieves there is, especially in women and endurance athletes.</td></tr>
<tr><td>Magnesium, sleep and muscle function</td><td>Established for deficiency effects</td><td>Low status demonstrably affects sleep quality and muscle function; supplementing past sufficiency does little.</td></tr>
<tr><td>Vitamin D and B12 status</td><td>Established</td><td>Deficiencies are common, consequential and correctable; status testing is routine medicine.</td></tr>
<tr><td>Hydration and electrolytes</td><td>Established</td><td>Small deficits measurably dent physical and mental performance. The least glamorous fix in this guide.</td></tr>
<tr><td>Heavy-metal exposure effects</td><td>Established toxicology, fenced claims</td><td>Lead, mercury, cadmium and arsenic have documented harms at documented exposures. Who is actually exposed matters more than headlines.</td></tr>
<tr><td>Screening snapshots</td><td>A starting point, not a diagnosis</td><td>Quick scans guide the conversation and the plan; confirmation and interpretation belong with a professional.</td></tr>
<tr><td>Peptides</td><td>Mostly early-stage</td><td>A few are approved medicines; the famous recovery ones run on animal and small-trial data, and the market is unregulated. Exactly why the safe path is a consult.</td></tr>
</table>
<p style="font-size:15px;color:#5b6673"><strong>How to read the labels:</strong> Established means repeatedly shown in controlled studies on people. Early-stage or exploratory means small human trials or lab and animal research: interesting, not yet proven. Wherever this guide cites an effect, we mean studies in people, not rats, and where the data is animal-only, the table says so.</p>`

export const spec: MasterDocSpec = {
  title: 'The Invisible Fuel Layer',
  subtitle: 'Test, do not guess: the deficiencies, exposures and shortcuts that quietly decide how fast you recover',
  coverAsset: 'w9_cover',
  coverChecklist: [
    'In a hurry? A five-minute version up front',
    'Why eating well is not the same as being well fueled',
    'The big four deficiencies that slow bounce-back, and who gets them',
    'Heavy metals without the hype: real exposure routes, documented effects',
    'The peptide landscape, honestly mapped, and why the safe path is a consult',
  ],
  introHtml:
    "<p>You know how to eat. Vegetables, protein, water, not too much of the fun stuff. If you are reading this, your plate is probably fine most days. And yet fueling has a layer your plate cannot show you: your actual status. Two people can eat identically while one runs low on iron and the other carries a mineral burden neither will ever feel directly. They just recover differently and never know why.</p><p>This guide is about that invisible layer: what runs low, what sneaks in, what the shortcut industry is selling, and the principle that beats all the guessing.</p><p><strong>The one-sentence version:</strong> supplement roulette is expensive and slow, and testing turns it into a plan.</p>",
  blocks: [
    // Dasha review 2026-11-02 ("punchier, more go-do"): whole program in five
    // steps up front, same pattern as Bounce Back Stronger.
    { kind: 'part', title: 'The five-minute version', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Busy? Start here',
      slotName: 'tldr',
      unnumbered: true,
      defaultHtml:
        '<p>Everything in this guide, in five steps. The rest of the pages explain why each one works. Read on when you want the reasoning; you do not need it to start.</p>',
      frozenHtml:
        '<ol><li><strong>Start the hydration protocol tomorrow.</strong> Water first thing every morning, a glass with every meal, electrolytes on your sweatiest days. Zero cost, effects inside a week.</li><li><strong>Skim the big four energy thieves</strong> (iron, magnesium, vitamin D, B12). If a symptom pattern sounds like you, write it down.</li><li><strong>Check your actual exposure routes:</strong> a big-fish habit, a home or pipes that predate modern standards, tobacco smoke, rice every day. No route, no worry.</li><li><strong>Book a status test instead of buying another supplement.</strong> Test, do not guess: status first, then the plan writes itself.</li><li><strong>If you have not yet, take the Body Resilience Score,</strong> the two-minute self-assessment on our website. Retake it after your 30 days and compare.</li></ol>',
    },
    { kind: 'part', title: 'What runs low', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The big four energy thieves',
      slotName: 'deficiencies',
      unnumbered: true,
      figure: { asset: 'w9_plate' },
      defaultHtml:
        '<p>Of all the things that can quietly slow a body down, a handful of deficiencies have the deepest evidence behind them, and all of them are common in exactly the people who think their diet is handled.</p>',
      frozenHtml:
        '<ul><li><strong>Iron.</strong> The best-documented energy thief in nutrition. Low iron means less oxygen delivery, which reads as fatigue, breathlessness on hills, and workouts that feel harder than they should. Most common in women and endurance athletes.</li><li><strong>Magnesium.</strong> Involved in hundreds of reactions, including the ones that run sleep and muscle relaxation. Low status is common and shows up as restless nights and crampy, slow-to-recover muscles.</li><li><strong>Vitamin D.</strong> The sunshine paradox: deficiency is common even in sunny places, because modern life happens indoors. Status affects bone, muscle and immune function, and testing for it is routine medicine.</li><li><strong>B12.</strong> Essential for nerves and blood, stored for years, then suddenly not. Especially worth knowing for anyone eating mostly plants.</li></ul><p>The pattern across all four: the symptoms are vague, the fixes are cheap, and guessing is the only expensive part. Which brings us to the principle this guide runs on.</p>',
      tipHtml:
        'Test, do not guess. A supplement cabinet built on guesswork is a subscription to maybe. Status first, then the plan writes itself.',
    },
    { kind: 'part', title: 'What sneaks in', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'Heavy metals without the hype',
      slotName: 'metals',
      unnumbered: true,
      defaultHtml:
        '<p>First, what this section is not: it is not the detox-industry story where everyone is toxic and a juice cleanse is the cure. Real toxicology is more specific and more interesting. A few metals, lead, mercury, cadmium and arsenic chief among them, have well-documented harms at well-documented exposures, and whether you should think about them depends mostly on your actual exposure routes.</p>',
      frozenHtml:
        '<ul><li><strong>Mercury</strong> rides mostly on large predatory fish. A tuna-and-swordfish habit is a real route; occasional sushi is not a crisis.</li><li><strong>Lead</strong> lives in old paint, old pipes and some imported goods: relevant if your home or water predates modern standards.</li><li><strong>Cadmium</strong> concentrates in tobacco smoke above all else.</li><li><strong>Arsenic</strong> turns up in rice and some groundwater, which matters mainly at high, daily intakes.</li></ul><p>Documented effects at meaningful exposures land on energy, the nervous system and cognition, which is exactly why they matter for how fast you recover. The honest boundary: nobody can look at your tiredness and blame a metal, and nobody honest promises a detox. What a professional can do is look at your actual routes, decide whether measuring makes sense, and read the results with you.</p>',
    },
    {
      kind: 'section',
      heading: 'The snapshot, and what it is for',
      slotName: 'testing',
      unnumbered: true,
      figure: { asset: 'w9_rhythm' },
      defaultHtml:
        '<p>So how do you find out? This is where testing enters, and where honesty matters most. Quick screening tools, from in-studio scans to blood panels, differ in depth and in how settled their science is. We treat every screening the same way: as a snapshot that guides the conversation, not a diagnosis. The value is in the loop it starts: measure, interpret with a professional, change one thing, measure again. That loop is the entire difference between a supplement drawer and a plan.</p>',
    },
    { kind: 'part', title: 'The shortcut aisle', startOnNewPage: true },
    {
      kind: 'section',
      heading: 'The peptide landscape, honestly mapped',
      slotName: 'peptides',
      unnumbered: true,
      defaultHtml:
        '<p>You have heard the word by now. Peptides are short protein fragments that act as biological signals, and a wave of them is being talked about for recovery, sleep and body composition. The excitement is not baseless: a few peptides are fully approved medicines, and the signaling idea is real biology. The honest map of the famous recovery names, though, looks like this: most of the evidence is animal work and small early trials, long-term human safety data is thin, and the products sold online live in an unregulated gray market where the label and the vial have only a loose relationship.</p>',
      frozenHtml:
        '<p>That last part is the point. The question with peptides is not only does it work, but what am I actually holding, and neither question is answerable from a webshop. If this landscape interests you, the safe path is boring and simple: a consultation with someone qualified, who knows the evidence, the sourcing reality and your health picture, and who will tell you honestly when the right answer is not yet, or not you, or not this one. That conversation is worth more than any vial.</p>',
    },
    { kind: 'part', title: 'Reading the evidence like an adult' },
    {
      kind: 'section',
      heading: 'Everything in this guide, placed honestly',
      slotName: 'evidence',
      unnumbered: true,
      defaultHtml: '<p>Here is where everything above actually stands:</p>',
      frozenHtml: evidenceTable,
      tipHtml:
        'These are the same labels we apply when we decide what earns a place in a plan.',
    },
    { kind: 'part', title: 'Your 30-day experiment' },
    {
      kind: 'section',
      heading: 'One month, one unglamorous fix',
      slotName: 'experiment',
      unnumbered: true,
      defaultHtml:
        '<p>While the testing loop is the real answer, there is one fuel fix with established evidence, zero cost and effects inside a week: hydration done properly.</p>',
      frozenHtml:
        '<p>For 30 days:</p><ol><li>Water first thing every morning.</li><li>A glass of water with every meal.</li><li>Electrolytes on your sweatiest days.</li></ol><p>Track three numbers each day:</p><ol><li>Your morning pulse.</li><li>One word for how your body feels: fresh, normal, heavy.</li><li>Afternoon energy, scored one to five.</li></ol><p>Small deficits in hydration measurably dent both body and brain, which means fixing them is the fastest honest win in this entire guide. At the end, retake the Body Resilience Score and see what the fuel input says. One month, one fix, your own data.</p>',
    },
    {
      kind: 'section',
      heading: 'If you want the real answer',
      slotName: 'close',
      unnumbered: true,
      defaultHtml:
        '<p>The real answer to this chapter is the loop: measure, interpret, change one thing, measure again. If you want to run it properly, book a consultation: that conversation is one we have every day. Bring your questions, bring your supplement drawer if you like, and leave with a plan built on your numbers instead of the internet&#39;s.</p>',
    },
  ],
  ctaParagraphHtml:
    'If this guide resonates, book a consultation. We will look at what to test instead of what to guess, and build a fuel plan on your numbers.',
  disclaimerHtml: wellnessDisclaimer('The Invisible Fuel Layer'),
}
