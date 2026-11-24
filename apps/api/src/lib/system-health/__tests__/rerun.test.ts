import { describe, it, expect, vi, beforeEach } from 'vitest'

const { jobFindMany, jobCreate, nlFindMany, nlUpdate, send, gate } = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobCreate: vi.fn(),
  nlFindMany: vi.fn(),
  nlUpdate: vi.fn(),
  send: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@omniply/shared', () => ({
  prisma: { articleJob: { findMany: jobFindMany, create: jobCreate }, newsletter: { findMany: nlFindMany, update: nlUpdate } },
}))
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../../queues/index', () => ({ getBoss: async () => ({ send }), QUEUES: { ARTICLE_PIPELINE: 'article-pipeline', NEWSLETTER_GENERATE: 'newsletter-generate' } }))
vi.mock('../../account-billing', () => ({ generationGateForUser: gate }))

import { rerunFailedWork, failedArticleTopics } from '../rerun'

/** First findMany = the failed jobs, second = jobs on those topics that did not fail. */
function articles(failed: Array<{ topicId: string; userId: string }>, alive: string[] = []) {
  jobFindMany.mockReset()
  jobFindMany.mockResolvedValueOnce(failed).mockResolvedValueOnce(alive.map((topicId) => ({ topicId })))
}

beforeEach(() => {
  jobCreate.mockReset()
  nlFindMany.mockReset()
  nlUpdate.mockReset()
  send.mockReset()
  gate.mockReset()
  let n = 0
  jobCreate.mockImplementation(async () => ({ id: `job${++n}` }))
  nlFindMany.mockResolvedValue([])
  nlUpdate.mockResolvedValue({})
  send.mockResolvedValue('ok')
  gate.mockResolvedValue({ allowed: true })
})

describe('failed article topics', () => {
  it('lists each topic once, however many times it failed (the Nov 21 retry failed every topic twice)', async () => {
    articles([
      { topicId: 't1', userId: 'dasha' },
      { topicId: 't2', userId: 'dasha' },
      { topicId: 't1', userId: 'dasha' },
    ])
    expect(await failedArticleTopics()).toEqual([
      { topicId: 't1', userId: 'dasha' },
      { topicId: 't2', userId: 'dasha' },
    ])
  })
  it('leaves a topic alone once any job on it has not failed', async () => {
    articles([{ topicId: 't1', userId: 'u' }, { topicId: 't2', userId: 'u' }], ['t2'])
    expect(await failedArticleTopics()).toEqual([{ topicId: 't1', userId: 'u' }])
  })
})

describe('re-running failed work', () => {
  it('creates one fresh job per topic and spaces the starts a minute apart', async () => {
    articles([
      { topicId: 't1', userId: 'u' },
      { topicId: 't2', userId: 'u' },
      { topicId: 't3', userId: 'u' },
    ])
    const r = await rerunFailedWork()
    expect(r.articles).toBe(3)
    expect(jobCreate).toHaveBeenCalledTimes(3)
    expect(jobCreate.mock.calls[0][0].data).toEqual({ topicId: 't1', userId: 'u', status: 'pending' })
    const starts = send.mock.calls.filter((c) => c[0] === 'article-pipeline').map((c) => c[2].startAfter)
    expect(starts).toEqual([0, 60, 120])
    expect(send.mock.calls[0][2]).toMatchObject({ singletonKey: 'job1', retryLimit: 2 })
  })
  it('puts failed newsletter editions back to pending under their usual key', async () => {
    articles([])
    nlFindMany.mockResolvedValue([{ id: 'n1', userId: 'u', topicId: 'nt1' }])
    const r = await rerunFailedWork()
    expect(r).toMatchObject({ articles: 0, newsletters: 1 })
    expect(nlUpdate).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { status: 'pending' } })
    expect(send).toHaveBeenCalledWith('newsletter-generate', { userId: 'u', topicId: 'nt1' }, expect.objectContaining({ singletonKey: 'nl-u-nt1' }))
  })
  it('skips an account that may not generate and says which', async () => {
    articles([{ topicId: 't1', userId: 'paused' }, { topicId: 't2', userId: 'ok' }])
    gate.mockImplementation(async (id: string) => ({ allowed: id === 'ok' }))
    const r = await rerunFailedWork()
    expect(r.articles).toBe(1)
    expect(r.skippedAccounts).toEqual(['paused'])
    expect(jobCreate.mock.calls[0][0].data.userId).toBe('ok')
  })
  it('can be limited to one account', async () => {
    articles([{ topicId: 't1', userId: 'dasha' }])
    await rerunFailedWork({ userId: 'dasha' })
    expect(jobFindMany.mock.calls[0][0].where.userId).toBe('dasha')
    expect(nlFindMany.mock.calls[0][0].where.userId).toBe('dasha')
  })
})
