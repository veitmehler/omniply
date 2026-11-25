import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'
import path from 'path'
import { listMotifs, motifAt, motifSetFor, nextMotif, renderMotifCanvas, resetMotifCache, MOTIF_STRENGTH } from '../motif-library'

beforeEach(() => resetMotifCache())

describe('motifSetFor: two sets, one per niche we sell to', () => {
  it('maps the niches we have, and nothing else', () => {
    expect(motifSetFor('Chiropractor')).toBe('chiropractic')
    expect(motifSetFor('B2B practice-growth software')).toBe('chiropractic')
    expect(motifSetFor('Wellness & Recovery')).toBe('wellness')
    expect(motifSetFor('Dentist')).toBeNull()
    expect(motifSetFor(null)).toBeNull()
  })
})

describe('the bundled library', () => {
  it('holds the approved shapes of batch one, without the two Veit dropped', () => {
    const chiro = listMotifs('chiropractic')
    const wellness = listMotifs('wellness')
    expect(chiro.length).toBeGreaterThanOrEqual(14)
    expect(wellness.length).toBeGreaterThanOrEqual(14)
    expect(chiro).not.toContain('12-a.png') // the adjusting table
    expect(wellness).not.toContain('09-a.png') // the crescent moon with a star
  })
  it('every file is a colourless single-channel shape', async () => {
    for (const set of ['chiropractic', 'wellness'] as const) {
      for (const f of listMotifs(set)) {
        const m = await sharp(path.join(process.cwd(), 'assets', 'motifs', set, f)).metadata()
        expect([f, m.channels]).toEqual([f, 1])
        expect(m.width).toBe(m.height)
      }
    }
  })
})

describe('motifAt: how an account steps through its set', () => {
  it('visits every item once before any repeats, for any set size', () => {
    for (const count of [2, 14, 28, 31, 60, 62]) {
      const seen = new Set(Array.from({ length: count }, (_, step) => motifAt(count, 'user-a', step)))
      expect([count, seen.size]).toEqual([count, count])
    }
  })
  it('never gives one account the same drawing twice in a row, and starts accounts in different places', () => {
    for (let step = 0; step < 120; step++) expect(motifAt(31, 'user-a', step)).not.toBe(motifAt(31, 'user-a', step + 1))
    const starts = new Set(['user-a', 'user-b', 'user-c', 'user-d', 'user-e'].map((u) => motifAt(31, u, 0)))
    expect(starts.size).toBeGreaterThan(1)
  })
})

describe('nextMotif', () => {
  it('gives each post in a batch the next drawing, and starts from the seed', () => {
    const files = listMotifs('chiropractic')
    const picks = Array.from({ length: files.length }, () => nextMotif('Chiropractor', 'user-a', 5)!.file)
    expect(new Set(picks).size).toBe(files.length)
    resetMotifCache()
    expect(nextMotif('Chiropractor', 'user-a', 5)!.file).toBe(picks[0])
    resetMotifCache()
    expect(nextMotif('Chiropractor', 'user-a', 6)!.file).toBe(picks[1])
  })
  it('returns nothing for a niche without a set', () => {
    expect(nextMotif('Dentist', 'user-a')).toBeNull()
  })
})

describe('renderMotifCanvas', () => {
  const corner = async (buf: Buffer) => {
    const { data } = await sharp(buf).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    return [data[0], data[1], data[2]]
  }
  it('with no shape it is the plain brand colour', async () => {
    const buf = await renderMotifCanvas({ shapePath: null, canvasHex: '#b85c38', inkHex: '#FFFFFF', size: 64 })
    expect(await corner(buf)).toEqual([0xb8, 0x5c, 0x38])
  })
  it('draws the shape in the ink colour and leaves the rest of the brand colour untouched', async () => {
    const file = path.join(process.cwd(), 'assets', 'motifs', 'chiropractic', listMotifs('chiropractic')[0])
    const size = 256
    const buf = await renderMotifCanvas({ shapePath: file, canvasHex: '#b85c38', inkHex: '#FFFFFF', size })
    const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let untouched = 0, lighter = 0, darkerOrShifted = 0, max = 0
    for (let i = 0; i < data.length; i += 3) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      if (r === 0xb8 && g === 0x5c && b === 0x38) untouched++
      else if (r >= 0xb8 && g >= 0x5c && b >= 0x38) lighter++
      else darkerOrShifted++
      max = Math.max(max, r)
    }
    expect(untouched / (size * size)).toBeGreaterThan(0.8) // most of the slide is the pure brand colour
    expect(lighter).toBeGreaterThan(0) // the lines are there, in white
    expect(darkerOrShifted).toBe(0) // nothing darkens or tints the brand colour
    // a full-strength line is the ink at MOTIF_STRENGTH over the canvas, never stronger
    expect(max).toBeLessThanOrEqual(Math.round(0xb8 + (255 - 0xb8) * MOTIF_STRENGTH) + 1)
  })
  it('a missing file falls back to the plain brand colour instead of failing the post', async () => {
    const buf = await renderMotifCanvas({ shapePath: '/nope/missing.png', canvasHex: '#2a6f97', inkHex: '#FFFFFF', size: 32 })
    expect(await corner(buf)).toEqual([0x2a, 0x6f, 0x97])
  })
})
