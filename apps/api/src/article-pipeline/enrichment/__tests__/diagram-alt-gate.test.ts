import { describe, it, expect } from 'vitest'
import { altTextIssue } from '../diagram-caption-generator'

describe('altTextIssue (B17)', () => {
  it('rejects chart-type vocabulary and self-reference', () => {
    expect(altTextIssue('State diagram tracing a path from long sitting through micro changes to hip hinges')).toBe('chart-type vocabulary')
    expect(altTextIssue('Mindmap of four causes of lower back pain linked to prolonged sitting')).toBe('chart-type vocabulary')
    expect(altTextIssue('Class diagram linking disc, nerve root and leg symptoms')).toBe('chart-type vocabulary')
    expect(altTextIssue('Flowchart branching sciatica red flags into emergency and routine care')).toBe('chart-type vocabulary')
    expect(altTextIssue('This image shows the four causes of back pain')).toBe('self-reference')
  })
  it('passes content descriptions', () => {
    expect(altTextIssue('Four causes of lower back pain after long sitting, from disc load to weak glutes')).toBeNull()
    expect(altTextIssue('A sciatica flare traced from first pain through two weeks of home care to the point of seeing a clinician')).toBeNull()
    expect(altTextIssue('Illustration of Why Does My Lower Back Hurt When Sitting')).toBeNull()
  })
})
