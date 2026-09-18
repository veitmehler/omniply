import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../../lib/net/instrument', () => ({
  instrumentCall: (_m: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('../../../lib/net/with-timeout', () => ({
  withTimeout: (fn: (s?: AbortSignal) => Promise<unknown>) => fn(),
}))

import sharp from 'sharp'
import { verifyRestyledDiagram } from '../diagram-verify'

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer()
}

function geminiResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  }
}

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})
beforeEach(() => vi.clearAllMocks())

describe('verifyRestyledDiagram', () => {
  it('returns pass with no issues', async () => {
    global.fetch = vi.fn().mockResolvedValue(geminiResponse({ verdict: 'pass', issues: [] })) as never
    const r = await verifyRestyledDiagram({ geminiKey: 'k', sourcePng: await png(), restyledPng: await png() })
    expect(r).toEqual({ verdict: 'pass', issues: [] })
  })

  it('returns fail with the concrete issues', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(geminiResponse({ verdict: 'fail', issues: ['label "Track" dropped'] })) as never
    const r = await verifyRestyledDiagram({ geminiKey: 'k', sourcePng: await png(), restyledPng: await png() })
    expect(r.verdict).toBe('fail')
    expect(r.issues).toEqual(['label "Track" dropped'])
  })

  it('degrades to error (accept-with-warn) on API failure — never throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as never
    const r = await verifyRestyledDiagram({ geminiKey: 'k', sourcePng: await png(), restyledPng: await png() })
    expect(r.verdict).toBe('error')
  })

  it('degrades to error on an unparseable verdict', async () => {
    global.fetch = vi.fn().mockResolvedValue(geminiResponse({ verdict: 'maybe' })) as never
    const r = await verifyRestyledDiagram({ geminiKey: 'k', sourcePng: await png(), restyledPng: await png() })
    expect(r.verdict).toBe('error')
  })
})
