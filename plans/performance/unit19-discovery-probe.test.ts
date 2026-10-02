import { EventEmitter } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { afterEach, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ commands: [] as string[][], reads: 0, pendingReads: 0, peakReads: 0 }))
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: () => ({ stdout: new EventEmitter(), stderr: new EventEmitter(), on() {}, kill() {} }),
}))
vi.mock('../../plugins/docker/src/server/cli', () => ({
  docker: async (args: string[]) => {
    probe.commands.push(args)
    await Promise.resolve()
    return args[0] === 'version' ? JSON.stringify({ Client: { Context: 'synthetic' }, Server: { Version: 'synthetic' } }) : ''
  },
  dockerEnv: () => ({}), DockerCliError: class extends Error {},
}))
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => '/synthetic/home' }))
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), readFile: async () => {
  probe.reads++
  probe.peakReads = Math.max(probe.peakReads, ++probe.pendingReads)
  await new Promise(resolve => setTimeout(resolve, 1))
  probe.pendingReads--
  throw new Error('synthetic missing config')
} }))

import { getDockerService, disposeDocker } from '../../plugins/docker/src/server/dockerService'
import { dockerBridge } from '../../plugins/docker/src/server/dockerBridge'

const records: Record<string, unknown>[] = []
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const destination = new URL(`unit19-discovery-${tag}.json`, import.meta.url)
if (/(?:^|-)before(?:-|$)/.test(tag) && existsSync(destination)) throw new Error('Before evidence exists; use another tag.')
afterEach(() => {
  disposeDocker()
  writeFileSync(destination, JSON.stringify({ runtime: process.version, external: 'mocked Docker CLI/fs, actual runtime owners', records }, null, 2) + '\n')
  probe.commands = []; probe.reads = 0; probe.pendingReads = 0; probe.peakReads = 0
})

it('counts simultaneous cold health probes and inventory probes', async () => {
  const service = getDockerService()
  await Promise.all(Array.from({ length: 16 }, () => service.info()))
  const healthCommands = probe.commands.filter(args => args[0] === 'version').length
  await Promise.all(Array.from({ length: 16 }, () => service.containers()))
  const inventoryCommands = probe.commands.filter(args => args[0] === 'ps').length
  records.push({ name: 'cold-health-and-list', requests: 16, healthCommands, inventoryCommands })
  expect(healthCommands).toBe(1)
  expect(inventoryCommands).toBe(1)
})

it('counts matcher reads with an empty container inventory', async () => {
  const count = 300
  const tasks = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, worktreePath: `/synthetic/worktree-${index}`, branch: `feature/task-${index}` }))
  const bridge = dockerBridge({ tasks: { active: async () => tasks } } as unknown as Parameters<typeof dockerBridge>[0])
  const cpu = process.cpuUsage()
  const started = performance.now()
  const result = await bridge.taskSummary()
  const used = process.cpuUsage(cpu)
  records.push({ name: 'empty-inventory-summary', tasks: count, containers: 0, returnedSummaries: result.length,
    configReads: probe.reads, peakConfigReads: probe.peakReads, elapsedMs: performance.now() - started,
    cpuMs: (used.user + used.system) / 1000, note: 'Each synthetic fs read has 1ms delay; elapsed is a waterfall demonstration, not disk timing.' })
  expect(result).toEqual([])
  expect(probe.reads).toBe(0)
  expect(probe.peakReads).toBe(0)
})
