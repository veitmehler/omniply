# Cold-Open Prompt Pack — AI-booking scene (Veo 3.1 via Flow)

The shot that sets up "When the world looks like this…": a patient asks
their phone's AI assistant to book a chiropractor — and the assistant
books the practice that answered. Generate in **Flow** (labs.google/flow),
NOT the Gemini chat app (visible watermark there).

## Flow settings — check on EVERY generation
- Model: Veo 3.1 (Fast for iteration, Quality for the final take)
- Audio: ON · Aspect: 16:9 · Resolution: highest offered (1080p)
- First export: confirm NO visible watermark and true 1080p. If either
  fails on the Pro tier, stop — Claude generates the final via API.

## The dialogue beat (fits one 8-second clip, spoken briskly)
- PERSON (~3s): "I woke up wiht a terrible backache. Please book me a chiropractor appointment with the practice that has the best reviews and answers AI assistant immediately. Book for tomorrow morning 8 am if they are open, if not 9am."
- AI VOICE (~3.5s): "Done. I booked the practice with the best reviews
  that answered right away."
- (~1.5s): silent beat — person nods, sets the phone down. The VO line
  "When the world looks like this…" enters here in the edit.

If a take crams the audio, drop "with the best reviews" — "I booked the
practice that answered right away" is the load-bearing half.

## Shared rules (append to every prompt / negative prompt field)
Negative prompt: `subtitles, captions, on-screen text, phone UI, app
interface, brand logos, Apple, Siri, watermark, extra fingers, deformed
hands`

Veo loves burning subtitles into dialogue scenes — "no subtitles, no
captions, no on-screen text" belongs in BOTH the prompt body and the
negative field. Keep the phone screen barely visible or showing only a
soft abstract waveform glow. Nobody says "Siri" or "Hey Google" — it is
always just the assistant.

---

## Variant A — Kitchen morning (the default)

> Cinematic medium close-up, 35mm, shallow depth of field. A woman in her
> late thirties in a bright modern kitchen, soft golden morning light
> through a window behind her. She stands slightly three-quarter to
> camera, one hand pressed to her lower back, wincing mildly. She holds
> her phone flat in front of her mouth like a walkie-talkie and speaks to
> it: "Book me a chiropractor appointment for tomorrow morning." A calm,
> softly synthetic assistant voice answers from the phone, its screen
> glowing with a faint abstract waveform: "Done. I booked the practice
> with the best reviews that answered right away." She nods, satisfied,
> and lowers the phone. Warm natural color grade, realistic, no subtitles,
> no captions, no on-screen text, no visible app interface.

## Variant B — Parked car

> Cinematic shot through the driver's window, morning light. A man around
> forty sits in the driver's seat of a parked car, easing himself in with
> a grimace, one hand braced on his lower back. He raises his phone flat
> in front of his mouth and says: "Book me a chiropractor appointment for
> tomorrow morning." A calm synthetic assistant voice replies from the
> phone speaker: "Done. I booked the practice with the best reviews that
> answered right away." He exhales in relief and drops the phone on the
> passenger seat. Realistic, shallow depth of field, natural reflections
> on the glass, no subtitles, no captions, no on-screen text, no phone
> interface visible.

## Variant C — Late-night couch (the 2am angle)

> Cinematic medium shot, moody dim living room at night, lit only by a
> single warm lamp and the soft glow of a phone. A man in his fifties
> sits on the edge of a couch, hunched, one hand kneading his lower
> back, clearly unable to sleep. He lifts the phone flat in front of his
> mouth and says quietly: "Find me a chiropractor. Book whatever's
> available tomorrow." The assistant's calm synthetic voice answers,
> screen pulsing with a faint waveform: "Done. I booked the practice
> that answered right away." He closes his eyes, relieved. Intimate,
> realistic, film grain, no subtitles, no captions, no on-screen text.

## Variant D — Over-the-shoulder (lip-sync insurance)

> Cinematic over-the-shoulder shot: we look past a person's shoulder at
> the phone they hold up in front of them, their face only partially
> visible in soft profile. The phone screen shows nothing but a gentle
> abstract waveform pulsing as they speak: "Book me a chiropractor
> appointment for tomorrow morning." The waveform swells as a calm
> synthetic assistant voice replies: "Done. I booked the practice with
> the best reviews that answered right away." Shallow depth of field,
> warm home interior bokeh background, realistic, no subtitles, no
> captions, no on-screen text, no app interface, no brand logos.

(D hides the mouth — use it if A–C keep failing on lip-sync.)

---

---

## Ping map — "the city of invisible bookings" (plays under the hook question)

Cuts in after the confirmation beat; each light = a booking an agent just
placed somewhere in town. Keep it ABSTRACT AERIAL — never a map app: roads
with labels, pin icons, or any UI invite Veo's warped-text artifacts.

### Variant P1 — night grid (the default)

> Slow cinematic aerial drone shot, high above a dark suburban city at
> night, streets forming a faint glowing grid, deep blue-black color
> grade. Sharp small points of cyan light bloom into existence one by one
> across the city, each with a soft brief pulse, like silent
> notifications appearing — first a few, then more and more, multiplying
> and accelerating until dozens are appearing every second across the
> whole grid. The camera drifts forward slowly and almost imperceptibly.
> Quiet, ominous ambient hum, no music. Photorealistic, atmospheric haze,
> no text, no labels, no map interface, no pin icons, no subtitles, no
> captions.

### Variant P2 — dusk (smoother cut from a daytime cold-open take)

> Slow cinematic aerial drone shot above a suburban city at dusk, the sky
> a fading orange-to-indigo gradient, city lights just coming on. Sharp
> small points of warm white-cyan light begin to bloom across the
> darkening grid one by one, each pulsing softly like a silent
> notification — sparse at first, then multiplying and accelerating as
> the sky darkens, until the whole city is flickering with them. Slow
> forward drift, photorealistic, atmospheric, quiet ambient tone, no
> music, no text, no labels, no map interface, no pin icons, no
> subtitles, no captions.

Negative prompt: `text, labels, street names, map interface, app UI, pin
icons, markers, subtitles, captions, music, cars with visible motion
trails, fireworks`

### Reject a take if…
- the lights read as ambient city glow instead of discrete EVENTS
  (each ping must visibly appear + pulse)
- the pace stays constant — the build/acceleration IS the menace
- any text, icons, or map-app framing appears
- the pings look like fireworks or explosions (too violent — they should
  feel silent and administrative)

Fallback: if 3 Fast takes fail, Claude builds the canvas version and
delivers a finished MP4 (exact timing, brand-colorable, any duration).
Hybrid: a gorgeous Veo aerial with weak pings can serve as the base
plate — Claude composites crisp pings over it with ffmpeg.

## Extension prompt (the narration bed, if the 8s clip ends too hard)

> Continue the scene: the person lowers the phone, exhales, and gazes out
> of the window in thought. No dialogue, only quiet room ambience. Camera
> holds, slow subtle push-in. No subtitles, no on-screen text.

## Take selection — reject a take if…
- lips drift out of sync on either line (three-quarter angles hide this
  best; dead-on framing shows it worst)
- hands/fingers deform or the phone morphs mid-shot
- ANY text, captions, or recognizable phone UI appears
- the assistant voice sounds human-warm instead of calm-synthetic (the
  slightly artificial timbre IS the story)
- the wince plays as slapstick — it should read as routine discomfort

## Workflow
1. 2–3 Fast takes per variant → pick the staging that works.
2. 2–3 more Fast takes of the winner to tune dialogue pacing.
3. Final candidate on Quality tier (or hand the exact prompt to Claude
   for an API render if Pro quota runs out / watermark appears).
4. Drop the picked take into `.documentation/marketing/` — the edit
   ducks its audio as "When the world looks like this…" enters.

---

## The 11pm shot — "nobody in the building has time" (Scene 1, grind beat)

Plays under "…that nobody in the building has time to do, right?" — the
one human face in the problem section. Present-day mood, NOT futuristic.

> Cinematic medium close-up, shallow depth of field, a dim kitchen at
> night. A tired practice owner in their forties sits at the kitchen
> table, still in work clothes, sleeves rolled up, face lit only by the
> cold glow of a laptop screen. They type a few words, stop, rub their
> eyes, look at the screen again. A mug and a stack of papers beside the
> laptop. The house is silent and dark behind them. Warm lamp far in the
> background, cold screen light on the face. Realistic, intimate, film
> grain, quiet room tone only, no music, no dialogue, no subtitles, no
> captions, no on-screen text, laptop screen content not visible.

Negative prompt: `subtitles, captions, on-screen text, visible screen
content, phone UI, brand logos, music, dialogue`

### Reject a take if…
- the laptop screen shows readable content (it must stay a glow — any
  generated UI will look fake)
- the mood plays as depressed rather than tired-but-dutiful
- hands deform while typing (frame the hands soft or partially off-frame)
- it reads "office" instead of "home after hours" — the kitchen is the point

---

## The unanswered ring — "calls you can't pick up" (Scene 11 opener, ~4s used)

Plays under "And for the calls you can't pick up, this:" — the problem
instant before the voice-receptionist explanation. No dialogue.

### Variant R1 — empty front desk at night (default)

> Cinematic medium shot, a small chiropractic clinic reception at night,
> lights off except one dim lamp, empty waiting chairs. A phone on the
> front desk lights up and rings, its screen glowing in the dark. It
> keeps ringing. Nobody comes. Slow, almost imperceptible push-in toward
> the ringing phone. Realistic, moody, shallow depth of field, quiet room
> tone with a soft phone ring, no music, no dialogue, no subtitles, no
> captions, no on-screen text, no visible phone interface details.

### Variant R2 — owner mid-treatment, can't answer

> Cinematic shot in a treatment room: a chiropractor in dark scrubs works
> with a patient on the table, fully focused, hands occupied. In the
> blurred foreground a phone on the counter buzzes and lights up,
> unanswered. The practitioner glances toward it for half a second and
> returns to the patient. Realistic, warm clinical light, shallow depth
> of field, soft buzz and quiet room tone, no music, no dialogue, no
> subtitles, no captions, no on-screen text.

Negative prompt: `subtitles, captions, on-screen text, phone UI, brand
logos, music, dialogue, extra fingers, deformed hands`

Reject a take if the ring reads as answered, the phone screen shows
readable UI, or the mood plays as alarming instead of quietly regretful.
