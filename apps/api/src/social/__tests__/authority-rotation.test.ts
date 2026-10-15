import { describe, it, expect } from 'vitest'
import { nextDraw, AUTHORITY_TYPES, type AuthorityBagState } from '../generators/authority-rotation'

/** Deterministic LCG so the shuffle is reproducible in tests. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function drawMany(count: number, seed: number): string[] {
  const rand = seededRand(seed)
  let state: AuthorityBagState = { bag: [], lastDrawn: null }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const r = nextDraw(state, rand)
    out.push(r.drawn)
    state = r.state
  }
  return out
}

describe('authority rotation (shuffled bag)', () => {
  it('never draws the same type twice in a row, across bag boundaries', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const seq = drawMany(60, seed)
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i], `seed ${seed} position ${i}`).not.toBe(seq[i - 1])
      }
    }
  })

  it('every bag of 5 contains all five types exactly once', () => {
    const seq = drawMany(50, 42)
    for (let bagStart = 0; bagStart < seq.length; bagStart += 5) {
      const bag = seq.slice(bagStart, bagStart + 5)
      expect([...bag].sort()).toEqual([...AUTHORITY_TYPES].sort())
    }
  })

  it('does not settle into one repeating 5-type sequence', () => {
    // With random shuffles the chance of 10 consecutive identical bags is
    // (1/5!)^9 — if all bags match, the shuffle is broken.
    const seq = drawMany(50, 7)
    const bags = []
    for (let i = 0; i < 50; i += 5) bags.push(seq.slice(i, i + 5).join(','))
    expect(new Set(bags).size).toBeGreaterThan(1)
  })

  it('recovers a corrupt/empty persisted state', () => {
    const r = nextDraw({ bag: [], lastDrawn: null }, seededRand(1))
    expect(AUTHORITY_TYPES).toContain(r.drawn)
    expect(r.state.bag).toHaveLength(4)
    expect(r.state.lastDrawn).toBe(r.drawn)
  })
})
