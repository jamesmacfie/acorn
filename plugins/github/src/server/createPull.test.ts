import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { createPullRequest } from './createPull'
import { gh } from './githubApi'
import { pullsResource } from './resourceKeys'
import { repos, syncState } from '../node/schema'
import type { GithubEmit } from './events'

vi.mock('./githubApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./githubApi')>()
  return { ...actual, gh: vi.fn() }
})

describe('createPullRequest events', () => {
  let plugin: TestPluginDb
  const emit = vi.fn<GithubEmit>()

  beforeEach(async () => {
    vi.clearAllMocks()
    plugin = makeTestPluginDb('github')
    await plugin.db.insert(repos).values({ userId: 'james', id: 7, owner: 'acme', name: 'widget', fetchedAt: 1 })
    await plugin.db.insert(syncState).values({
      userId: 'james',
      resource: pullsResource(7, 'open'),
      etag: '"pulls-v1"',
      fetchedAt: 1,
    })
  })

  afterEach(() => plugin.cleanup())

  it('announces the repository after GitHub accepts the pull and the open-list mirror is invalidated', async () => {
    vi.mocked(gh).mockResolvedValue(new Response(JSON.stringify({ number: 73 }), {
      headers: { 'content-type': 'application/json' },
    }))

    const result = await createPullRequest('token', plugin.db, 'james', 'acme', 'widget', {
      title: 'Ship it',
      base: 'main',
      head: 'feature',
    }, emit)

    expect(result).toEqual({ ok: true, number: 73 })
    expect(await plugin.db.select().from(syncState).where(and(
      eq(syncState.userId, 'james'),
      eq(syncState.resource, pullsResource(7, 'open')),
    ))).toEqual([])
    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith('pulls-changed', { repoOwner: 'acme', repoName: 'widget' })
  })

  it('does not invalidate or announce a pull GitHub rejects', async () => {
    vi.mocked(gh).mockResolvedValue(new Response(JSON.stringify({ message: 'Validation Failed' }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    }))

    const result = await createPullRequest('token', plugin.db, 'james', 'acme', 'widget', {
      title: 'Ship it',
      base: 'main',
      head: 'feature',
    }, emit)

    expect(result).toMatchObject({ ok: false })
    expect(await plugin.db.select().from(syncState)).toHaveLength(1)
    expect(emit).not.toHaveBeenCalled()
  })
})
