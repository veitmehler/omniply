/** Shared bits for the master specs (leadgen master-library plan Phase C). */

/** Wellness-vertical disclaimer (claims policy 2026-10-20: education and
 * habit support, never treatment; nutrition content is general, not advice). */
export function wellnessDisclaimer(title: string): string {
  return (
    `This guide ("${title}") is provided for general educational purposes only. It offers everyday ` +
    'lifestyle and habit ideas, not medical or nutritional advice, and it is not a substitute for ' +
    'professional diagnosis or treatment. Nothing here is intended to treat, cure, or prevent any ' +
    'disease or condition. Always consult a qualified healthcare provider about your individual ' +
    'situation before starting new exercise, sleep, or eating routines, and seek professional care ' +
    'promptly if something has been persistently bothering you. ' +
    '© {{brand.organizationName}}. You are welcome to share this guide in its complete, unmodified form.'
  )
}

export function disclaimer(title: string): string {
  return (
    `This guide ("${title}") is provided for general educational purposes only and is not a ` +
    'substitute for professional diagnosis, advice, or treatment. Always consult a qualified ' +
    'healthcare provider about your individual situation before starting new exercises or ' +
    'self-care routines. If you experience severe pain, numbness, weakness, or any of the ' +
    'warning signs described in this guide, seek professional care promptly. ' +
    '© {{brand.organizationName}}. You are welcome to share this guide in its complete, unmodified form.'
  )
}
