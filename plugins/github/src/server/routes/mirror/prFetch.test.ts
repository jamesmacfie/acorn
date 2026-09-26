import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapLimited } from '../../mapLimited'
import { fakeGithub, makeFakePull, type FakeRequest } from './fakeGithub.helper'
import { fetchFiles, fetchPullComposite, walkConnection } from './prFetch'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const filePages = (requests: FakeRequest[]) => requests.filter((r) => r.kind === 'files').length

afterEach(() => vi.unstubAllGlobals())

describe('fetchFiles', () => {
  it('reads 2,200 files in 22 pages, in GitHub order', async () => {
    const fake = fakeGithub(makeFakePull({ files: 2200 }))
    vi.stubGlobal('fetch', fake.fetch)

    const result = await fetchFiles('token', 'acme', 'web', 7)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(2200)
    expect(result.value.files.map((f) => f.filename)).toEqual(Array.from({ length: 2200 }, (_, i) => `src/file-${i}.ts`))
    expect(result.value.completeness).toEqual({ kind: 'complete' })
    expect(filePages(fake.requests)).toBe(22)
    expect(fake.requests.some((r) => r.kind === 'pull')).toBe(false)
  })

  it('calls 3,000 of a reported 3,000 complete', async () => {
    const fake = fakeGithub(makeFakePull({ files: 3000, changedFiles: 3000 }))
    vi.stubGlobal('fetch', fake.fetch)
    const result = await fetchFiles('token', 'acme', 'web', 7)
    expect(result.ok && result.value.completeness).toEqual({ kind: 'complete' })
    expect(filePages(fake.requests)).toBe(30)
  })

  it('calls 3,000 of a reported 3,418 capped by GitHub', async () => {
    const fake = fakeGithub(makeFakePull({ files: 3418, changedFiles: 3418 }))
    vi.stubGlobal('fetch', fake.fetch)
    const result = await fetchFiles('token', 'acme', 'web', 7)
    expect(result.ok && result.value.files).toHaveLength(3000)
    expect(result.ok && result.value.completeness).toEqual({
      kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: 3000, reportedTotal: 3418, limit: 3000,
    })
    expect(filePages(fake.requests)).toBe(30)
  })

  it('calls a full 30th page without a reported total incomplete', async () => {
    const fake = fakeGithub(makeFakePull({ files: 3500, changedFiles: null }))
    vi.stubGlobal('fetch', fake.fetch)
    const result = await fetchFiles('token', 'acme', 'web', 7)
    expect(result.ok && result.value.completeness).toEqual({
      kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: 3000, reportedTotal: null, limit: 3000,
    })
  })

  it('fails when a middle page fails, a path repeats, or a page is malformed', async () => {
    const failing = fakeGithub(makeFakePull({ files: 2200 }), {
      override: (r) => (r.kind === 'files' && r.page === 12 ? new Response('unavailable', { status: 500 }) : undefined),
    })
    vi.stubGlobal('fetch', failing.fetch)
    expect(await fetchFiles('token', 'acme', 'web', 7)).toEqual({ ok: false, failure: { error: 'github_unavailable', status: 502 } })
    expect(filePages(failing.requests)).toBe(12)

    const pull = makeFakePull({ files: 300 })
    pull.files[250] = { ...pull.files[250]!, filename: pull.files[10]!.filename }
    vi.stubGlobal('fetch', fakeGithub(pull).fetch)
    expect(await fetchFiles('token', 'acme', 'web', 7)).toMatchObject({ ok: false, failure: { error: 'github_malformed' } })

    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 300 }), {
      override: (r) => (r.kind === 'files' && r.page === 2 ? json([{ filename: 'x.ts' }]) : undefined),
    }).fetch)
    expect(await fetchFiles('token', 'acme', 'web', 7)).toMatchObject({ ok: false, failure: { error: 'github_malformed' } })
  })
})

describe('fetchPullComposite', () => {
  it('walks every connection to its end: 400 threads, a 250-comment thread, 150 commits, 120 checks', async () => {
    const fake = fakeGithub(makeFakePull({
      threads: 400,
      commentsPerThread: (t) => (t === 3 ? 250 : 2),
      commits: 150,
      checks: 120,
      comments: 130,
      reviews: 101,
      labels: 5,
    }))
    vi.stubGlobal('fetch', fake.fetch)

    const result = await fetchPullComposite('token', 'acme', 'web', 7)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pull = result.value
    expect(pull.threads).toHaveLength(400)
    expect(pull.threads.map((t) => t.id)).toEqual(Array.from({ length: 400 }, (_, i) => `thread-${i}`))
    expect(pull.threads[3]!.comments).toHaveLength(250)
    expect(pull.threads[3]!.comments.at(-1)!.id).toBe('thread-3-comment-249')
    expect(pull.commits).toHaveLength(150)
    expect(pull.checks).toHaveLength(120)
    expect(pull.comments).toHaveLength(130)
    expect(pull.reviews).toHaveLength(101)
    expect(pull.labels).toHaveLength(5)
    const pages = fake.requests.filter((r): r is Extract<FakeRequest, { kind: 'graphql-page' }> => r.kind === 'graphql-page')
    expect(pages.filter((r) => r.field === 'reviewThreads').map((r) => r.after)).toEqual(['100', '200', '300'])
    expect(pages.filter((r) => r.ownerType === 'PullRequestReviewThread').map((r) => r.after)).toEqual(['100', '200'])
  })

  it('keeps thread comment requests within the concurrency bound', async () => {
    const fake = fakeGithub(makeFakePull({ threads: 40, commentsPerThread: () => 150 }))
    vi.stubGlobal('fetch', fake.fetch)
    const result = await fetchPullComposite('token', 'acme', 'web', 7)
    expect(result.ok && result.value.threads.every((t) => t.comments.length === 150)).toBe(true)
    expect(fake.maxInFlight()).toBeGreaterThan(1)
    expect(fake.maxInFlight()).toBeLessThanOrEqual(4)
  })

  it('fails on a partial GraphQL error, a malformed page, or a failed continuation', async () => {
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ threads: 150 }), {
      override: (r) => (r.kind === 'graphql-page' ? json({ data: { node: null }, errors: [{ message: 'timeout' }] }) : undefined),
    }).fetch)
    expect(await fetchPullComposite('token', 'acme', 'web', 7)).toEqual({ ok: false, failure: { error: 'graphql', status: 502, detail: ['timeout'] } })

    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ commits: 150 }), {
      override: (r) => (r.kind === 'graphql-page' ? json({ data: { node: { page: { nodes: [{ commit: null }], pageInfo: { endCursor: null, hasNextPage: false } } } } }) : undefined),
    }).fetch)
    expect(await fetchPullComposite('token', 'acme', 'web', 7)).toMatchObject({ ok: false, failure: { error: 'github_malformed', detail: ['commits'] } })

    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ checks: 150 }), {
      override: (r) => (r.kind === 'graphql-page' ? new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } }) : undefined),
    }).fetch)
    expect(await fetchPullComposite('token', 'acme', 'web', 7)).toEqual({ ok: false, failure: { error: 'rate_limited', status: 429 } })
  })
})

describe('walkConnection', () => {
  const page = (ids: string[], endCursor: string | null, hasNextPage: boolean) => ({ nodes: ids.map((id) => ({ id })), pageInfo: { endCursor, hasNextPage } })

  it('fails on a repeated cursor rather than looping or stopping short', async () => {
    const next = vi.fn(async () => ({ ok: true as const, value: page(['b'], 'c1', true) }))
    const result = await walkConnection<{ id: string }>('reviews', page(['a'], 'c1', true), next, (n) => n.id)
    expect(result).toMatchObject({ ok: false, failure: { error: 'github_pagination', detail: ['reviews'] } })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('keeps a node seen on two pages once, where it first appeared', async () => {
    const next = vi.fn(async () => ({ ok: true as const, value: page(['b', 'c'], 'c2', false) }))
    const result = await walkConnection<{ id: string }>('reviews', page(['a', 'b'], 'c1', true), next, (n) => n.id)
    expect(result.ok && result.value.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('fails on a next page with no cursor', async () => {
    const result = await walkConnection<{ id: string }>('reviews', page(['a'], null, true), vi.fn(), (n) => n.id)
    expect(result).toMatchObject({ ok: false, failure: { error: 'github_pagination' } })
  })
})

describe('mapLimited', () => {
  it('never has more than the limit in flight and keeps item order', async () => {
    let inFlight = 0
    let max = 0
    const out = await mapLimited(Array.from({ length: 20 }, (_, i) => i), 3, async (n) => {
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return n * 2
    })
    expect(max).toBe(3)
    expect(out).toEqual(Array.from({ length: 20 }, (_, i) => i * 2))
  })

  it('stops starting items after the first throw', async () => {
    const started: number[] = []
    await expect(mapLimited([0, 1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n)
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (n === 1) throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(started.length).toBeLessThan(6)
  })
})
