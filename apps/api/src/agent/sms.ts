/**
 * Voice SMS delivery templates (.plans/voice-sms-delivery.implementation-plan.md).
 *
 * SMS bodies are DETERMINISTIC — never model-authored. Delivery rides the
 * clinic's GHL location (LeadConnector SMS): the channel patients already
 * know, visible to the front desk in the conversation stream, no cost to us.
 */

/** Hard cap per conversation — abuse guard (plan §4). */
export const SMS_PER_CONVERSATION_CAP = 3

export function buildGuideSms(practiceName: string, guideTitle: string, link: string): string {
  return `${practiceName}: here is your ${guideTitle} — ${link} . Reply STOP to opt out.`
}

export function buildBookingSms(practiceName: string, bookingUrl: string): string {
  return `${practiceName}: book your visit here — ${bookingUrl} . Reply STOP to opt out.`
}
