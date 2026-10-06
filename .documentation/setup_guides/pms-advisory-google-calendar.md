# Advisory Availability via Google Calendar (Tier 2) — Setup Guide

For clinics whose PMS has no open API (see the per-PMS playbook in
`.plans/pms-connector-framework.implementation-plan.md`). The voice agent
speaks up to three visible times WITH the mandatory staleness disclaimer and
texts the booking link — it never books in this mode.

## The chain
PMS → (its Google Calendar export) → clinic Google Calendar →
GHL calendar (Google sync, conflict check ON) →
`agentBookingMode = 'advisory-gcal'` + `agentBookingCalendarId = <that GHL calendar>`.

## Clinic-side steps
1. **PMS → Google** (per platform):
   - **Jane**: each practitioner subscribes Google Calendar to their Jane
     calendar feed (Jane guide "Subscribing to Your Calendar"). NOTE: this
     is an iCal feed — Google refreshes it every few HOURS. That staleness
     is exactly why the disclaimer is mandatory.
   - **zHealth / ChiroFusion**: use their native Google Calendar
     integration — VERIFY with the clinic that appointments actually appear
     in Google before enabling (depth varies).
   - No PMS→Google path (ChiroTouch/ChiroSpring/TM3) → this tier is
     unavailable; use Tier 3 (patterns).
2. **Google → GHL**: in the clinic's GHL location → Settings → Calendars →
   the practitioner's calendar → Connections: connect the Google account,
   enable **"Check for conflicts"** against the synced calendar.
3. **GHL calendar availability**: set the calendar's working hours to the
   clinic's real hours (free slots = working hours minus Google busy).

## Omniply-side steps (admin, until the Settings surface exists)
- `accounts.agentBookingMode = 'advisory-gcal'`
- `accounts.agentBookingCalendarId = <GHL calendar id>`

## VERIFICATION GATE (do not skip — plan requirement)
Create a test event in the clinic's Google Calendar covering a time the GHL
calendar would offer, wait for GHL to register the conflict, then confirm
via a test call (or `bookingInfoFor`) that the slot DISAPPEARED from what
the agent can see. Only then tell the clinic the tier is live.

## What the agent says (locked phrasing, engine-enforced)
Up to three times, always with: "the front desk might have recently booked
one of those slots — open the booking link I'm sending, confirm the
available times, and book right there." `book_appointment` is disabled by
the validator in this mode.
