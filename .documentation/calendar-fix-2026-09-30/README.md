# Calendar seasonal-integrity fix — 2026-09-30

Hemisphere-rotation defects in the shared chiro content calendars:
calendars were authored for one hemisphere and the counterpart derived by
a 6-month date rotation, leaving absolute anchors (Easter, Christmas/New
Year, Thanksgiving/Halloween/solstice, month names, school terms)
textually wrong. Errors concentrated in year-2 tails + Family Care
Northern year-1 (the rotated-from-southern original).

- Pass 1 (fix-calendars.js): heuristic + LLM audit of all 20 calendars
  (~4,100 rows) → 298 violations → 242 minimal-edit fixes applied
  (195 article, 47 newsletter rows; changed nl rows got research reset
  to pending; none were drafted). changelog-pass1.txt
- Pass 2 (fix-calendars-p2.js): corrected duplicate-guard (a topic may
  stay identical to its own row for bullet-only fixes) → 45 more fixes.
  changelog-pass2.txt
- Pass 3 (fix-p3.js): 7 deterministic hand-fixes (Thanksgiving/solstice/
  Halloween/Black-Friday/New-Year stragglers incl. a Sept↔Oct Halloween
  theme swap in P&P Northern). Output embedded in the script's log above.
- Renamed newsletter calendar "Family Care - Nothern" → "Northern".

Accepted (NOT defects, reviewed): intentional seasonal contrasts
("New Year Energy Without the Winter" in southern Jan, "harder than
summer grass" in southern winter) and the September/March "reset"
new-year-metaphor newsletter pieces. The pass-1 LLM judge also produced
self-refuting flags (southern winter-sport topics in Jun–Aug are
CORRECT); guards prevented any such row from being modified.

Re-run the audit anytime: fix-calendars.js phases A/D (judge+verify) are
non-destructive until the apply step; use it as the import-time check for
any future calendar.

## Pass 4 + final verification (2026-09-30, same day)

An independent re-audit (fresh LLM pass, widened heuristic incl.
Thanksgiving/Halloween/solstice, duplicate + field checks) surfaced a
4th defect class: the year-2/year-3 repeat cycle DRIFTS by days-to-weeks,
so tail-year rows (mostly 2028) carried slipped month-names/holidays
("August Baby Boom" on Jul 6, Father's Day in April, "Postpartum in
January" in June). Every flag was human-adjudicated: 36 fragment-surgery
fixes applied (fix-p4.js, changelog-pass4.txt); the rest are documented
accepts (prep-window ≤~6wks, rhetorical contrasts, post-holiday pieces).
The ~900 "duplicate" pairs are the DESIGNED one-year topic repeat cycle —
not defects.

FINAL STATE: verify-lite.js reports **0 flags** across all 20 calendars.
csv-snapshots/ holds the full corrected export (date+topic for articles;
date+topic+bullets for newsletters) — the repo's restorable source of
truth as of 2026-09-30. TOTAL fixed across all passes: 330 rows.
