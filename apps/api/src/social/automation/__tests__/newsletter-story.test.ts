import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { resolveNewsletterSlotContent, type NewsletterContentContext } from '../newsletter-content'
import { commentHookFromTheme, commentFbAppendFromTheme } from '../../brand-theme'

const CTX: NewsletterContentContext = {
  overviewTopics: ['Feature title', 'Second piece'],
  tips: ['Tip one', 'Tip two'],
  feature: { title: 'Feature title', body: 'Feature body text' },
  storyArc: [
    { postText: 'Beat zero post', slides: ['Hook zero', 'Body zero'] },
    { postText: 'Beat one post', slides: ['Hook one', 'Body one', 'CTA'] },
  ],
}

describe('resolveNewsletterSlotContent nl_story', () => {
  it('resolves beats by index with slides', () => {
    const b0 = resolveNewsletterSlotContent('nl_story', CTX, 0)
    expect(b0).toMatchObject({ text: 'Beat zero post', title: 'Hook zero' })
    expect(b0.storySlides).toEqual(['Hook zero', 'Body zero'])
    const b1 = resolveNewsletterSlotContent('nl_story', CTX, 1)
    expect(b1.text).toBe('Beat one post')
  })

  it('missing beat/arc falls back to the feature', () => {
    expect(resolveNewsletterSlotContent('nl_story', CTX, 5)).toMatchObject({
      text: 'Feature body text',
      title: 'Feature title',
    })
    expect(resolveNewsletterSlotContent('nl_story', { ...CTX, storyArc: null }, 0)).toMatchObject({
      text: 'Feature body text',
    })
  })
})

describe('comment-keyword theme helpers', () => {
  it('builds hook + FB append from a dm_keyword theme', () => {
    const t = { commentKeyword: 'SPINE', commentAsset: 'our 2-Minute Spine Check' }
    expect(commentHookFromTheme(t)).toBe('Comment "SPINE" and we will send you our 2-Minute Spine Check.')
    expect(commentFbAppendFromTheme(t)).toBe('Or just comment "SPINE" and we will send it straight to you.')
  })

  it('returns null without a keyword', () => {
    expect(commentHookFromTheme({ commentKeyword: null, commentAsset: null })).toBeNull()
    expect(commentFbAppendFromTheme({ commentKeyword: null })).toBeNull()
  })

  it('defaults the asset description', () => {
    expect(commentHookFromTheme({ commentKeyword: 'GUIDE', commentAsset: null })).toBe(
      'Comment "GUIDE" and we will send you our free guide.',
    )
  })
})
