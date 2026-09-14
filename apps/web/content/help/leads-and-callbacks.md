---
title: Leads and callbacks in your CRM
description: Where every lead lands, what the tags mean, and how your front desk works the queue.
order: 10
---

Everything the funnels and assistants capture flows into one place: the Contacts in your Omniply CRM. Nothing lives only "in the AI"; your front desk works out of the CRM exactly as they would with any enquiry.

## Where leads come from

- **The Spine Check funnel:** someone comments SPINE, gets the quiz by DM, takes it, and becomes a contact with their results and follow-up emails running automatically.
- **The website chat assistant:** callback requests and guide downloads become contacts with a conversation summary attached.
- **The voice assistant:** callers become contacts the moment they leave a name and number, with notes from the call.

## Reading a lead at a glance

Open any contact and check two things:

**Tags** tell you the story:
- `chat-agent-lead`: captured by the chat or voice assistant.
- `callback-requested`: they asked for a call back. This is your action queue.
- `sms-sent`: the assistant texted them a guide or booking link.
- `human-requested` and `ai-off`: they asked for a person; the assistant has gone silent on this conversation and your team should take over.

**Notes** carry the substance. A callback note includes the reason, a short summary of the whole conversation, the caller's **preferred time** if they named one, and a warning line if a live transfer to your team went unanswered first.

## The callback notification

When a callback is requested, the **Chat Callback Request** automation notifies your front desk by SMS or email. The notification can include the conversation summary and the preferred time through these merge fields, already on the contact:

- `{{contact.chat_summary}}`
- `{{contact.callback_preferred_time}}`

## Taking over from the AI

Add the tag **ai-off** to a contact and the assistant stops replying in that conversation; your team speaks directly from the CRM's conversation view. Remove the tag to hand the conversation back. When a visitor asks for a human, the assistant applies the tag itself and leaves a handover note.

## Good habits

- **Work the `callback-requested` tag daily.** These are warm leads who asked to hear from you; the preferred time in the note tells you when.
- **Skim conversation summaries, not transcripts.** The summary is written for exactly this purpose. Full transcripts are in your dashboard when you need them.
- **Watch for the unanswered-transfer note.** It means a live caller wanted a person and nobody could pick up: call them back first.
