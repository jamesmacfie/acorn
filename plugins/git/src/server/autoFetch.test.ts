import { expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { RemoteService } from './remotes'
import { AutoFetcher, AUTO_FETCH_CADENCE_MS } from './autoFetch'

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function fixture() {
  let now = 1000, enabled = false
  const calls: string[] = []
  const gate = deferred<{ ok: boolean }>()
  const started = deferred<void>()
  const core = {
    identity: { active: () => 'owner' }, prefs: { read: async () => enabled ? 'true' : 'false' },
    projects: { checkouts: async () => [
      { id: 'alias-a', path: '/tmp/auto-fetch-a' }, { id: 'alias-b', path: '/tmp/auto-fetch-b' }, { id: 'other', path: '/tmp/auto-fetch-c' },
    ] },
    git: { git: async (_args: string[], opts: { cwd: string }) => ({ code: 0, stdout: opts.cwd.endsWith('c') ? '/tmp/common-other\n' : '/tmp/common-alias\n', stderr: '' }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'prefs' | 'identity'>
  const remotes = {
    roster: async (projectId: string) => ({ repository: projectId, remotes: [{ name: 'origin', fetchUrl: '/tmp/bare.git', pushUrl: '/tmp/bare.git' }], lastFetch: {} }),
    change: async (projectId: string) => { calls.push(projectId); if (calls.length === 2) started.resolve(); return projectId === 'alias-a' ? gate.promise : { ok: false } },
  } as unknown as Pick<RemoteService, 'roster' | 'change'>
  const fetcher = new AutoFetcher(core, remotes, () => now)
  return { fetcher, calls, gate, started, enable: () => { enabled = true }, advance: (ms: number) => { now += ms } }
}

it('starts no network work while off, deduplicates aliases, bounds parallel work, and keeps cadence', async () => {
  const state = fixture()
  await state.fetcher.tick()
  expect(state.calls).toEqual([])
  state.enable()
  const first = state.fetcher.tick()
  await state.started.promise
  expect(state.calls.sort()).toEqual(['alias-a', 'other'])
  expect(await state.fetcher.tick()).toContain('already running')
  state.gate.resolve({ ok: true })
  expect(await first).toContain('1 remotes fetched, 1 failed')
  state.advance(AUTO_FETCH_CADENCE_MS - 1)
  await state.fetcher.tick()
  expect(state.calls).toHaveLength(2)
  state.advance(1)
  await state.fetcher.tick()
  expect(state.calls).toHaveLength(4)
  state.fetcher.dispose()
  state.advance(AUTO_FETCH_CADENCE_MS)
  await state.fetcher.tick()
  expect(state.calls).toHaveLength(4)
})
