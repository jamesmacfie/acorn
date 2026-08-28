import { afterEach, describe, expect, it } from 'vitest'
import type { Env } from '../../main/bindings'
import { registerRoute, removePluginRoutes } from '../routeRegistry'
import { clearRunSources, readRuns, registerRunSource } from './registry'

// The merged run list, driven through the real dispatcher: two plugins each serve a `/runs` route and
// the host merges the answers. What is worth pinning is the merge, not the fan-out — provenance is
// stamped by the host, a source that cannot answer costs its own rows and nobody else's, and the order
// is stable.

const env = { ACTIVE_IDENTITY: { get: () => 'owner-1' } } as unknown as Env

const serve = (pluginId: string, body: () => unknown): void => {
  registerRoute({
    plugin: pluginId,
    prefix: '',
    fetch: () => Promise.resolve(new Response(JSON.stringify(body()), { headers: { 'content-type': 'application/json' } })),
  })
  registerRunSource({ pluginId, runs: `/v2/p/${pluginId}/runs` })
}

const run = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, title: id, status: 'running', startedAt: 1_000, ...over })

describe('the merged run list', () => {
  afterEach(() => {
    for (const plugin of ['alpha', 'beta']) {
      clearRunSources(plugin)
      removePluginRoutes(plugin)
    }
  })

  it('merges two plugins newest-first and stamps who answered', async () => {
    serve('alpha', () => ({ runs: [run('a1', { startedAt: 3_000 })] }))
    serve('beta', () => ({ runs: [run('b1', { startedAt: 5_000 }), run('b2', { startedAt: 1_000 })] }))
    const { runs, failed } = await readRuns(env)
    expect(runs.map((row) => [row.pluginId, row.id])).toEqual([['beta', 'b1'], ['alpha', 'a1'], ['beta', 'b2']])
    expect(failed).toEqual([])
  })

  it('never lets a source name itself', async () => {
    // The stamp is the host's. A plugin claiming to be another one gets overwritten, not believed.
    serve('alpha', () => ({ runs: [{ ...run('a1'), pluginId: 'beta' }] }))
    expect((await readRuns(env)).runs[0].pluginId).toBe('alpha')
  })

  it('costs a bad source its own rows and nobody else\'s', async () => {
    serve('alpha', () => ({ runs: [run('a1')] }))
    // Not a run list. A shorter list is a better answer than no list, and `failed` says so out loud.
    serve('beta', () => ({ nonsense: true }))
    const { runs, failed } = await readRuns(env)
    expect(runs.map((row) => row.id)).toEqual(['a1'])
    expect(failed).toEqual(['beta'])
  })

  it('forgets a plugin\'s source when the plugin goes', async () => {
    serve('alpha', () => ({ runs: [run('a1')] }))
    clearRunSources('alpha')
    expect((await readRuns(env)).runs).toEqual([])
  })
})
