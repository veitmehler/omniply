import { describe, it, expect } from 'vitest'
import { extractLabelInventory } from '../mermaid-label-lint'
import { buildInventoryBlock, buildRetryFeedbackBlock } from '../diagram-restyle'

const inv = (syntax: string) => Object.fromEntries(extractLabelInventory(syntax).map((l) => [l.label, l.count]))

describe('extractLabelInventory — flowchart', () => {
  it('collects node labels once per node and edge labels per edge', () => {
    const src = `flowchart TD
    A[Start Here] --> B{Can You Walk?}
    B -->|Yes| C[Keep Moving]
    B -->|No| D([Call The Clinic])
    C --> D`
    expect(inv(src)).toEqual({
      'Start Here': 1,
      'Can You Walk?': 1,
      'Keep Moving': 1,
      'Call The Clinic': 1,
      Yes: 1,
      No: 1,
    })
  })

  it('counts a repeated label on distinct nodes with its true multiplicity', () => {
    const src = `flowchart LR
    A[Body] --> B[Mind]
    C[Body] --> B`
    expect(inv(src)['Body']).toBe(2)
  })

  it('normalizes <br/> and quoted labels', () => {
    const src = `flowchart TD
    A["Roll Standard<br/>Bath Towel"] --> B[Done]`
    expect(inv(src)['Roll Standard Bath Towel']).toBe(1)
  })

  it('uses the bare id for unlabeled camelCase nodes (pre-lint syntax)', () => {
    const src = `flowchart TD
    StartHere --> B[End]`
    expect(inv(src)['StartHere']).toBe(1)
  })
})

describe('extractLabelInventory — stateDiagram (live diagram-3 shape)', () => {
  const SRC = `stateDiagram-v2
    state "Hips below knees" as HipsBelowKnees
    [*] --> CheckHipKneeRelation
    CheckHipKneeRelation --> HipsBelowKnees: Hips lower than knees
    HipsBelowKnees --> SpinalStrain: Loss of load-bearing arch`

  it('prefers display declarations, falls back to raw ids, and counts transition labels', () => {
    const i = inv(SRC)
    expect(i['Hips below knees']).toBe(1)
    expect(i['CheckHipKneeRelation']).toBe(1)
    expect(i['SpinalStrain']).toBe(1)
    expect(i['Hips lower than knees']).toBe(1)
    expect(i['Loss of load-bearing arch']).toBe(1)
  })
})

describe('extractLabelInventory — phantom edge-label ids (d11 false positive)', () => {
  it('does not invent a node from the first word of an edge label', () => {
    const src = `flowchart TD
    B{Does hip hinge open freely?} -->|Yes| C[Hip lengthens]
    B -->|No - Hip tight| D[Lumbar compensates]`
    const i = inv(src)
    // Edge labels tallied as themselves; NO phantom "No" node entry beyond them.
    expect(i['Yes']).toBe(1)
    expect(i['No - Hip tight']).toBe(1)
    expect(i['No']).toBeUndefined()
  })
})

describe('extractLabelInventory — safety', () => {
  it('returns empty for unknown types and garbage', () => {
    expect(extractLabelInventory('sequenceDiagram\n A->>B: hi')).toEqual([])
    expect(extractLabelInventory('')).toEqual([])
  })
})

describe('prompt blocks', () => {
  it('inventory block is count-anchored and bans other text', () => {
    const b = buildInventoryBlock([
      { label: 'Body', count: 2 },
      { label: 'Start Here', count: 1 },
    ])
    expect(b).toContain('## EXACT TEXT INVENTORY (mandatory)')
    expect(b).toContain('"Body" (appears exactly 2 times)')
    expect(b).toContain('"Start Here" (appears exactly once)')
    expect(b).toContain('NO other text')
  })

  it('empty inventory produces no block', () => {
    expect(buildInventoryBlock([])).toBe('')
  })

  it('retry feedback is positive/count-anchored, never a bare negation', () => {
    const b = buildRetryFeedbackBlock(["'Can You Walk?' appeared twice"])
    expect(b).toContain('## PREVIOUS ATTEMPT CORRECTION')
    expect(b).toContain("'Can You Walk?' appeared twice")
    expect(b).toContain('exactly the stated number of times')
    expect(buildRetryFeedbackBlock([])).toBe('')
  })
})
