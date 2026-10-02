import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/client'
const api = vi.hoisted(() => ({ info: vi.fn(), containers: vi.fn(), summaries: vi.fn() }))
vi.mock('./dockerClient', () => ({ fetchDockerInfo: api.info, fetchContainers: api.containers, fetchTaskSummaries: api.summaries }))
vi.mock('./wsChannel', () => ({ wsOnDockerChanged: () => () => {} }))
import { containers, dockerTaskSummary, refreshDocker, refreshDockerTaskSummaries } from './dockerStore'
import { retireDockerClient } from './dockerScope'
const held = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  setActiveNode('a')
  api.info.mockResolvedValue({ available: true, version: 'fixture', context: null })
  api.containers.mockResolvedValue([{ id: 'same', name: 'A' }])
  api.summaries.mockResolvedValue([{ taskId: 'same', total: 1, running: 1, projects: [] }])
})
afterEach(() => { retireDockerClient(); setActiveNode(null); vi.clearAllMocks() })

it('keeps late A health from requesting B inventory or erasing B state', async () => {
  const a = held<unknown>()
  api.info.mockReturnValueOnce(a.promise)
  const old = refreshDocker()
  await Promise.resolve()
  setActiveNode('b')
  api.containers.mockResolvedValue([{ id: 'same', name: 'B' }])
  await refreshDocker()
  a.resolve({ available: true, version: 'A', context: null })
  await old
  expect(api.containers).toHaveBeenCalledTimes(1)
  expect(api.containers).toHaveBeenCalledWith('b')
  expect(containers()).toMatchObject([{ name: 'B' }])
})

it('preserves last-known inventory and task links when an observation fails', async () => {
  await refreshDocker(); await refreshDockerTaskSummaries()
  api.containers.mockRejectedValue(new Error('offline'))
  api.summaries.mockRejectedValue(new Error('offline'))
  await refreshDocker(); await refreshDockerTaskSummaries()
  expect(containers()).toMatchObject([{ name: 'A' }])
  expect(dockerTaskSummary('same')?.total).toBe(1)
  api.info.mockResolvedValue({ available: false, reason: 'daemon_down', detail: 'fixture' })
  await refreshDocker()
  expect(containers()).toHaveLength(1)
})

it('fences held summary waves across A/B/A generations', async () => {
  const a = held<any[]>()
  api.summaries.mockReturnValueOnce(a.promise)
  const old = refreshDockerTaskSummaries()
  setActiveNode('b'); setActiveNode('a')
  api.summaries.mockResolvedValue([{ taskId: 'same', total: 2, running: 2, projects: [] }])
  await refreshDockerTaskSummaries()
  a.resolve([{ taskId: 'same', total: 99, running: 99, projects: [] }])
  await old
  expect(dockerTaskSummary('same')?.total).toBe(2)
})

it('fences a pre-mutation read while joining the replacement refresh', async () => {
  const old = held<any[]>(), fresh = held<any[]>()
  api.containers.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  const a = refreshDocker()
  await vi.waitFor(() => expect(api.containers).toHaveBeenCalledTimes(1))
  const b = refreshDocker(true)
  await vi.waitFor(() => expect(api.containers).toHaveBeenCalledTimes(2))
  old.resolve([{ name: 'stale' }]); await a
  const joined = refreshDocker()
  fresh.resolve([{ name: 'fresh' }])
  await Promise.all([b, joined])
  expect(api.containers).toHaveBeenCalledTimes(2)
  expect(containers()).toMatchObject([{ name: 'fresh' }])
})
