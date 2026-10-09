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

it('claims the first tick before preference read and stops discovery when disabled or disposed', async () => {
  const preference = deferred<string>()
  const discovery = deferred<{ code: number; stdout: string; stderr: string }>()
  const entered = deferred<void>()
  const calls: string[] = []
  const core = { identity: { active: () => 'owner' }, prefs: { read: () => preference.promise },
    projects: { checkouts: async () => [{ id: 'a', path: '/tmp/a' }, { id: 'b', path: '/tmp/b' }] },
    git: { git: async (_: unknown, options: { cwd: string }) => { calls.push(options.cwd); entered.resolve(); return discovery.promise } },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'prefs' | 'identity'>
  const remoteCalls: string[] = []
  const remote = { roster: async (id: string) => { remoteCalls.push(id); return { remotes: [{ name: 'origin', fetchUrl: '/tmp/remote' }] } }, change: async () => ({ ok: true }) } as unknown as Pick<RemoteService, 'roster' | 'change'>
  const fetcher = new AutoFetcher(core, remote)
  const first = fetcher.tick()
  expect(await fetcher.tick()).toContain('already running')
  preference.resolve('true')
  await entered.promise
  fetcher.setEnabled(false)
  discovery.resolve({ code: 0, stdout: '/tmp/common\n', stderr: '' })
  await first
  expect(calls).toEqual(['/tmp/a'])
  expect(remoteCalls).toEqual([])
  fetcher.dispose()
})

it('does not start another remote after disposal during an in-flight fetch', async () => {
  const gate = deferred<{ ok: boolean }>()
  const entered = deferred<void>()
  const calls: string[] = []
  const core = { identity: { active: () => 'owner' }, prefs: { read: async () => 'true' },
    projects: { checkouts: async () => [{ id: 'a', path: '/tmp/a' }] },
    git: { git: async () => ({ code: 0, stdout: '/tmp/common\n', stderr: '' }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'prefs' | 'identity'>
  const remote = { roster: async () => ({ remotes: [{ name: 'one', fetchUrl: '/tmp/one' }, { name: 'two', fetchUrl: '/tmp/two' }] }),
    change: async (_: string, change: { name: string }) => { calls.push(change.name); entered.resolve(); return gate.promise },
  } as unknown as Pick<RemoteService, 'roster' | 'change'>
  const fetcher = new AutoFetcher(core, remote)
  const tick = fetcher.tick()
  await entered.promise
  fetcher.dispose()
  gate.resolve({ ok: false })
  await tick
  expect(calls).toEqual(['one'])
})
