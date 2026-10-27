# Lead-gen delivery emails as drag-and-drop templates

API-generated GHL email-builder (drag-and-drop) templates for the "Lead
Generation Docs Delivery" workflow: 5 branches (one per lead-magnet tag),
each branch = the requested guide's access email immediately, then one email
per remaining guide with "Wait until Sunday 9:00 AM (America/New_York)"
between them. The 25 steps dedupe into 11 distinct templates per vertical.

Built 2026-10-27 from Veit's approved "DND probe (delete me)" layout
(editorData captured from the builder's own network call; the structure is
MJML-flavored: `{id, tagName, children}` element trees + an `attrs` map
keyed by element id, text content in `attrs[id].content`).

## Generator

`build.mjs` + `sample-core.json` (structural blocks) + `sample-preview.html`
(rendered shell the `html` field is transplanted into).

```
WELLNESS_PIT=pit-... node build.mjs wellness   # creates templates via API
CHIRO_PIT=pit-...    node build.mjs chiro      # same for the chiro snapshot
node build.mjs chiro                           # no PIT: writes payload JSONs only
```

Endpoints: `POST /emails/builder` (type `builder`, builderVersion 2) then
`POST /emails/builder/data` (dnd + html + editorType builder + previewText).
Each run verifies the server-compiled previewJson contains the email's first
paragraph. Trigger links embed by ID (`{{trigger_link.<id>}}`) and are
location-specific — the script holds both locations' maps; for a new
vertical, list links via `GET /links/?locationId=...` and extend `CFG`.

NOTE: reading editorData back via API is impossible (internal scope). To
re-capture a layout, use the builder's network tab (`builder/data` request).

## WELLNESS templates — CREATED 2026-10-27 (location dyDcrf5pZnHXVXA7Rhx4)

| Template | Subject (set on the workflow step) |
|---|---|
| Guide delivery - Bounce Back Stronger | Your guide is here + one quick question |
| Guide delivery - The Sleep Upgrade | Your guide is here + one quick question |
| Guide delivery - The Deep Rest Protocol | Your guide is here + one quick question |
| Guide delivery - The Invisible Fuel Layer | Your guide is here + one quick question |
| Guide delivery - First Visit | Your guide is here + one quick question |
| Sunday read - First Visit | Your guide is here + one quick question |
| Sunday read - Bounce Back Stronger | Your guide is here + one quick question |
| Bonus Guide - Bounce Back Stronger | Your results are capped by your recovery |
| Bonus Guide - The Sleep Upgrade | Tired of being tired? |
| Bonus Guide - The Deep Rest Protocol | Stress is not your enemy |
| Bonus Guide - The Invisible Fuel Layer | Two people eat the same. One recovers faster. |

Preheaders are baked into each template (previewText).

### Wellness branch assignment (email 1 immediate, then Sunday waits)

| Branch (requested guide / tag) | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| The Sleep Upgrade | delivery SU | Sunday read FV | bonus BB | bonus IF | bonus DR |
| Bounce Back Stronger | delivery BB | Sunday read FV | bonus SU | bonus IF | bonus DR |
| First Visit | delivery FV | Sunday read BB | bonus SU | bonus IF | bonus DR |
| The Deep Rest Protocol | delivery DR | Sunday read FV | bonus BB | bonus SU | bonus IF |
| The Invisible Fuel Layer | delivery IF | Sunday read FV | bonus BB | bonus SU | bonus DR |

(BB=Bounce Back Stronger, SU=Sleep Upgrade, DR=Deep Rest Protocol,
IF=Invisible Fuel Layer, FV=First Visit. Mirrors the chiro branch shapes.)

After the workflow is wired: the 8 old plain-HTML templates in the wellness
location (Guide delivery - Everyday Strength/Better Sleep/Switch Off/
Everyday Fuel, Nurture day 1, Nurture day 4, plus any leftovers) are
superseded and can be deleted. The old paste-sheet flow
(.documentation/wellness-nurture-paste-sheet.md) is superseded by this doc.

## CHIRO templates — payloads ready, PUSH PENDING (needs chiro-snapshot PIT)

Same 11-template shape, copy verbatim from the workflow export
(.documentation copy dated 27 Oct 2026) with three fixes Veit flagged:
1. "what did you pick from the ... guide" → genericized to "from your
   guide" (one template now serves every branch correctly),
2. Morning Habits guide name unified to "7 Morning Habits That Are
   Wrecking Your Spine",
3. the branch-5 merged-paragraph Morning variant normalized to the
   standard two-paragraph version.

| Template | Subject |
|---|---|
| Guide delivery - Better Sleep Without Pills | Your guide is here + one quick question |
| Guide delivery - Desk Worker's Survival Guide | Your guide is here + one quick question |
| Guide delivery - First Chiropractic Visit | Your guide is here + one quick question |
| Guide delivery - 7 Morning Habits | Your guide is here + one quick question |
| Guide delivery - Pain Normal or Warning Sign | Your guide is here + one quick question |
| Sunday read - First Chiropractic Visit | Your guide is here + one quick question |
| Sunday read - Desk Worker's Survival Guide | Your desk is winning. Here's how to fight back. |
| Bonus Guide - Desk Worker's Survival Guide | Your desk is winning. Here's how to fight back. |
| Bonus Guide - Better Sleep Without Pills | Tired of being tired? |
| Bonus Guide - Pain Normal or Warning Sign | "That pain'll go away on its own", or will it? |
| Bonus Guide - 7 Morning Habits | You're sabotaging your spine before breakfast |

### Chiro branch assignment (matches the existing workflow's order)

| Branch | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Better Sleep Without Pills | delivery BS | Sunday read FV | bonus DW | bonus PW | bonus MH |
| Desk Worker's Survival Guide | delivery DW | Sunday read FV | bonus BS | bonus PW | bonus MH |
| First Chiropractic Visit | delivery FV | Sunday read DW | bonus BS | bonus PW | bonus MH |
| 7 Morning Habits | delivery MH | Sunday read FV | bonus DW | bonus BS | bonus PW |
| Pain Normal or Warning Sign | delivery PW | Sunday read FV | bonus DW | bonus BS | bonus MH |
