import { describe, it, expect } from 'vitest'
import { repairBareLabels, splitCamelLabel } from '../mermaid-label-lint'

describe('splitCamelLabel', () => {
  it('splits camelCase into readable words', () => {
    expect(splitCamelLabel('HipsBelowKnees')).toBe('Hips below knees')
    expect(splitCamelLabel('PelvisTiltsBackward')).toBe('Pelvis tilts backward')
    expect(splitCamelLabel('CheckHipKneeRelation')).toBe('Check hip knee relation')
  })

  it('preserves acronym runs', () => {
    expect(splitCamelLabel('USDAPlan')).toBe('USDA plan')
  })

  it('splits digit boundaries', () => {
    expect(splitCamelLabel('Step2Plan')).toBe('Step2 plan')
  })
})

describe('repairBareLabels — stateDiagram', () => {
  // The exact defect from the live run-5 article (diagram 3).
  const SRC = `stateDiagram-v2
    [*] --> CheckHipKneeRelation
    CheckHipKneeRelation --> HipsBelowKnees: Hips lower than knees
    CheckHipKneeRelation --> HipsAboveKnees: Hips slightly higher
    HipsBelowKnees --> PelvisTiltsBackward
    PelvisTiltsBackward --> LumbarCurveFlattens
    LumbarCurveFlattens --> SpinalStrain: Loss of load-bearing arch`

  it('injects display declarations for every bare camelCase state', () => {
    const out = repairBareLabels(SRC)
    expect(out).toContain('state "Check hip knee relation" as CheckHipKneeRelation')
    expect(out).toContain('state "Hips below knees" as HipsBelowKnees')
    expect(out).toContain('state "Pelvis tilts backward" as PelvisTiltsBackward')
    expect(out).toContain('state "Spinal strain" as SpinalStrain')
    // Transitions untouched; transition labels untouched.
    expect(out).toContain('CheckHipKneeRelation --> HipsBelowKnees: Hips lower than knees')
  })

  it('does not duplicate declarations that already exist', () => {
    const declared = `stateDiagram-v2
    state "Hips below knees" as HipsBelowKnees
    [*] --> HipsBelowKnees`
    const out = repairBareLabels(declared)
    expect(out.match(/as HipsBelowKnees/g)?.length).toBe(1)
  })

  it('leaves single-word states alone', () => {
    const simple = `stateDiagram-v2
    [*] --> Start
    Start --> Done`
    expect(repairBareLabels(simple)).toBe(simple)
  })
})

describe('repairBareLabels — flowchart', () => {
  it('attaches a label at the first bare occurrence only', () => {
    const src = `flowchart TD
    StartHere --> CheckPosture
    CheckPosture --> Done[All done]`
    const out = repairBareLabels(src)
    expect(out).toContain('StartHere[Start here] --> CheckPosture[Check posture]')
    expect(out).toContain('CheckPosture --> Done[All done]')
  })

  it('never touches nodes that are labeled anywhere in the doc', () => {
    const src = `flowchart TD
    GoodNode[Nice label] --> GoodNode
    GoodNode --> Other[x]`
    expect(repairBareLabels(src)).toBe(src)
  })

  it('does not mangle edge labels or quoted text', () => {
    const src = `flowchart LR
    A[Start] -->|CamelCaseEdge| B[End]`
    expect(repairBareLabels(src)).toBe(src)
  })
})

describe('repairBareLabels — other types / safety', () => {
  it('passes unknown diagram types through unchanged', () => {
    const seq = `sequenceDiagram
    AliceBobCat->>John: hello`
    expect(repairBareLabels(seq)).toBe(seq)
  })

  it('never throws on garbage input', () => {
    expect(repairBareLabels('')).toBe('')
    expect(repairBareLabels('%% just a comment')).toBe('%% just a comment')
  })
})
