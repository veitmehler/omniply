# Motif library: prompt and subject lists

Used for the chiropractic and wellness sets on 2026-11-25, model `gemini-3.1-flash-lite-image`, aspect 1:1.

## Prompt

> Elegant minimalist line-art icon of [subject]. One single subject, drawn in fine, even dark lines on a pure white background. Large in the frame, placed off-centre, with generous empty space around it. Refined and understated, like a mark from a high-end brand. No fill colours, no shading, no gradients, no shadows. Completely wordless: no text, letters, numbers, labels or logos.

Second composition of a subject, appended:

> This is a second, different composition of the subject: show it from another angle than the standard icon view, or as a closer partial view that runs off one edge of the frame.

## Conversion to a shape

greyscale → negate → `linear(255/140, -(10*255)/140)` → that is the coverage (white = line). Stored as a single-channel PNG at 1024px.

## Chiropractic subjects

1 spine curve, side view · 2 single vertebra from above · 3 two open hands · 4 posture figure with plumb line · 5 pelvis, front view · 6 branching nerve pathways · 7 head and neck in profile · 8 knee joint · 9 foot arch, side view · 10 figure in a side stretch · 11 spinal disc as concentric rings · 12 adjusting table (DROPPED) · 13 pillow with neck contour · 14 shoulder joint · 15 pair of footprints · 16 three stacked vertebrae with discs · 17 neck curve alone · 18 rib cage in outline · 19 shoulder blade · 20 hip joint · 21 nerve root leaving the spine · 22 base of skull meeting first vertebra · 23 sacrum · 24 single hand, palm up · 25 seated figure at a desk · 26 figure walking · 27 figure sleeping on its side · 28 plumb bob on a line · 29 office chair · 30 standing desk · 31 foam roller · 32 resistance band loop

## Wellness subjects

1 single leaf · 2 water ripples · 3 lotus flower · 4 balanced stacked stones · 5 rising sun on the horizon · 6 swirl of breath · 7 seated meditation figure · 8 water drop · 9 crescent moon with one star (DROPPED: reads as a religious symbol) · 10 hyperbaric chamber capsule · 11 snowflake · 12 flame · 13 sprouting seed · 14 feather · 15 heartbeat line · 16 sprig with three leaves · 17 curling wave · 18 lungs in outline · 19 heart · 20 two cupped hands · 21 massage table, side view · 22 oxygen molecule · 23 steaming cup · 24 glass of water · 25 tree with roots · 26 mountain ridge line · 27 rolled yoga mat · 28 kettlebell · 29 running shoe · 30 brain in outline · 31 hourglass · 32 citrus slice
