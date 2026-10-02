import { spawn as nativeSpawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ path: '/acorn-unit19-missing-binary' }))
vi.mock('../../plugins/docker/src/server/cli', () => ({ dockerEnv: () => ({ PATH: state.path }), docker: vi.fn(), DockerCliError: class extends Error {} }))
import * as before from './evidence/unit19-dockerService-before'
import * as after from '../../plugins/docker/src/server/dockerService'
import { SharedDockerStreams } from '../../plugins/docker/src/server/sharedStreams'

it('records actual ENOENT ownership, shared end delivery, and subsequent admission', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample', baseline = tag.includes('before')
  const runtime = baseline ? before : after
  const service = runtime.getDockerService()
  const streams = (service as unknown as { streams: Set<ReturnType<typeof nativeSpawn>> }).streams
  const shared = new SharedDockerStreams(service), subscriptions: { stop(): void }[] = []
  let errors = 0, closes = 0, exits = 0, ends = 0
  const closed: Promise<void>[] = []
  const dir = await mkdtemp(join(tmpdir(), 'acorn-unit19-docker-'))
  try {
    for (let i = 0; i < 32; i++) {
      subscriptions.push(shared.attach('logs', `fixture-${i}`, () => {}, () => { ends++ }))
      const child = [...streams].at(-1)!
      child.on('error', () => errors++); child.on('close', () => closes++); child.on('exit', () => exits++)
      closed.push(new Promise(resolve => child.once('close', () => resolve())))
    }
    await Promise.all(closed)
    const failed = { errors, closes, exits, ends, retainedFailedChildren: streams.size }
    expect(failed).toEqual({ errors: 32, closes: 32, exits: 0, ends: baseline ? 0 : 32, retainedFailedChildren: baseline ? 32 : 0 })
    await writeFile(join(dir, 'docker'), '#!/bin/sh\nprintf "healthy fixture\\n"\n', { mode: 0o700 })
    state.path = dir
    let healthy = ''
    await new Promise<void>(resolve => {
      subscriptions.push(shared.attach('logs', 'healthy', frame => { if (frame.channel === 'docker:log') healthy += frame.data }, () => { ends++; resolve() }))
    })
    expect(healthy).toBe(baseline ? '' : 'healthy fixture\n')
    const dest = new URL(`unit19-spawn-${tag}.json`, import.meta.url)
    if (baseline && existsSync(dest)) throw new Error('Baseline exists')
    writeFileSync(dest, JSON.stringify({ runtime: process.version, owner: 'actual ChildProcess and SharedDockerStreams; missing binary and disposable CLI fixture; no daemon', failed, healthyOutput: healthy, endsAfterHealthy: ends }, null, 2) + '\n')
  } finally {
    subscriptions.forEach(sub => sub.stop())
    runtime.disposeDocker()
    await rm(dir, { recursive: true, force: true })
  }
})
