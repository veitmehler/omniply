import { describe, it, expect } from 'vitest'
import { remapPostMedia } from '../recompose'

const MAP = new Map([
  ['https://cdn.example.com/old-1.png', 'https://cdn.example.com/new-1.png'],
  ['https://cdn.example.com/old-3.png', 'https://cdn.example.com/new-3.png'],
])

describe('remapPostMedia — recompose dual-write to Post rows', () => {
  it('remaps only matching mediaUrls entries, preserving order and untouched slides', () => {
    const next = remapPostMedia(
      {
        mediaUrls: [
          'https://cdn.example.com/old-1.png',
          'https://cdn.example.com/keep-2.png',
          'https://cdn.example.com/old-3.png',
        ],
        imageUrl: null,
      },
      MAP,
    )
    expect(next.changed).toBe(true)
    expect(next.mediaUrls).toEqual([
      'https://cdn.example.com/new-1.png',
      'https://cdn.example.com/keep-2.png',
      'https://cdn.example.com/new-3.png',
    ])
    expect(next.imageUrl).toBeNull()
  })

  it('remaps a platform-trimmed subset (GHL slide caps) by URL, not by index', () => {
    const next = remapPostMedia(
      { mediaUrls: ['https://cdn.example.com/old-3.png'], imageUrl: 'https://cdn.example.com/old-3.png' },
      MAP,
    )
    expect(next.changed).toBe(true)
    expect(next.mediaUrls).toEqual(['https://cdn.example.com/new-3.png'])
    expect(next.imageUrl).toBe('https://cdn.example.com/new-3.png')
  })

  it('reports unchanged for text-only story posts (no media)', () => {
    const next = remapPostMedia({ mediaUrls: [], imageUrl: null }, MAP)
    expect(next.changed).toBe(false)
  })

  it('reports unchanged when no URL matches', () => {
    const next = remapPostMedia(
      { mediaUrls: ['https://cdn.example.com/other.png'], imageUrl: 'https://cdn.example.com/other.png' },
      MAP,
    )
    expect(next.changed).toBe(false)
    expect(next.mediaUrls).toEqual(['https://cdn.example.com/other.png'])
  })
})
