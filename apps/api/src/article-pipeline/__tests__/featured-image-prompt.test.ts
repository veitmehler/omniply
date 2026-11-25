import { describe, it, expect } from 'vitest'
import { featuredImagePrompt } from '../image-generation'

/** The step-15 prompt of the bench article whose image came back with a misspelled title drawn on it (2026-11-25). */
const STEP_15 = `**Image Generation Prompt:**

Create a professional and visually engaging featured image that captures the essence of the article titled "Why Your Lower Back Aches After Sitting All Day (and a 5-Minute Reset)". The image should have a 16:9 aspect ratio and embody a modern, clean aesthetic.

**Composition:**
- The central focus of the image should be a person sitting at a modern desk, looking slightly uncomfortable while working on a laptop.`

describe('featuredImagePrompt: no text in the image, as a rule', () => {
  it('opens and closes with the no-text rule', () => {
    const p = featuredImagePrompt(STEP_15)
    expect(p.startsWith('An image with NO text in it.')).toBe(true)
    expect(p).toMatch(/no text of any kind: no words, letters, numbers, titles/)
    expect(p.trimEnd().endsWith('into the image.')).toBe(true)
  })
  it('no longer hands the model a quoted title to print', () => {
    const p = featuredImagePrompt(STEP_15)
    expect(p).not.toMatch(/titled\s+"/)
    expect(p).not.toContain('"Why Your Lower Back')
    expect(p).toContain('article on this subject: Why Your Lower Back Aches After Sitting All Day (and a 5-Minute Reset)')
    expect(p).not.toContain('Image Generation Prompt')
    expect(p).toContain('a person sitting at a modern desk')
  })
  it('keeps the closing rule even when the prompt is far too long', () => {
    const p = featuredImagePrompt('A calm clinic room. '.repeat(400))
    expect(p.length).toBeLessThanOrEqual(2_000)
    expect(p.trimEnd().endsWith('into the image.')).toBe(true)
  })
  it('an empty prompt still carries the rule', () => {
    expect(featuredImagePrompt('')).toMatch(/NO text in it[\s\S]*no text of any kind/)
  })
})
