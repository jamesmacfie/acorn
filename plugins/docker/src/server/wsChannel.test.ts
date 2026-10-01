import { beforeEach, expect, it, vi } from 'vitest'
import type { CompiledPluginBroadcast } from '@acorn/plugin-api/node'

const fixture = vi.hoisted(() => ({ open: vi.fn(), spawn: vi.fn() }))
vi.mock('./dockerService', () => ({ getDockerService: () => ({ openStream: fixture.open }) }))
vi.mock('./cli', () => ({ dockerEnv: () => ({}) }))
vi.mock('node-pty', () => ({ spawn: fixture.spawn }))
import { registerDockerWsChannel } from './wsChannel'

let handler: Parameters<CompiledPluginBroadcast['channel']>[1]
beforeEach(() => {
  fixture.open.mockReset(); fixture.spawn.mockReset()
  registerDockerWsChannel({ send() {}, status() {}, worktreeStatus() {}, repoConfigTrustNotice() {}, notice() {}, on: () => ({ dispose() {} }), streams() {}, channel: (_prefix, value) => { handler = value } })
})

it('shares a producer across distinct opaque connection tokens and retains only live handles after synchronous end', () => {
  let line!: (data: string) => void
  const stop = vi.fn()
  fixture.open.mockImplementation((_kind, _ref, output) => { line = output; return { stop } })
  const physicalA = {}, physicalB = {}
  const a = vi.fn(), b = vi.fn()
  handler.onFrame({ channel: 'docker:logs:attach', id: 'container' }, a, physicalA)
  line('history')
  handler.onFrame({ channel: 'docker:logs:attach', id: 'container' }, b, physicalB)
  expect(fixture.open).toHaveBeenCalledTimes(1)
  expect(a).toHaveBeenCalledTimes(1)
  expect(b).toHaveBeenCalledWith({ channel: 'docker:log', id: 'container', data: 'history' })
  handler.onDisconnect(physicalA); expect(stop).not.toHaveBeenCalled()
  line('live'); expect(b).toHaveBeenLastCalledWith({ channel: 'docker:log', id: 'container', data: 'live' })
  handler.onDisconnect(physicalB); expect(stop).toHaveBeenCalledTimes(1)
  fixture.open.mockImplementationOnce((_kind, _ref, _output, end) => { end(); return { stop } })
  handler.onFrame({ channel: 'docker:logs:attach', id: 'container' }, a, physicalA)
  handler.onFrame({ channel: 'docker:logs:attach', id: 'container' }, a, physicalA)
  expect(fixture.open).toHaveBeenCalledTimes(3)
  handler.onDisconnect(physicalA)
})

it('keeps interactive exec independent for equal exec IDs in different viewers', () => {
  const first = { kill: vi.fn(), write: vi.fn(), resize: vi.fn(), onData: vi.fn(), onExit: vi.fn() }
  const second = { kill: vi.fn(), write: vi.fn(), resize: vi.fn(), onData: vi.fn(), onExit: vi.fn() }
  fixture.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
  const a = {}, b = {}, send = vi.fn()
  const open = { channel: 'docker:exec:open', ref: 'container', execId: 'same', cols: 80, rows: 24 }
  handler.onFrame(open, send, a); handler.onFrame(open, send, b)
  expect(fixture.spawn).toHaveBeenCalledTimes(2)
  handler.onFrame({ channel: 'docker:exec:in', execId: 'same', data: 'only-a' }, send, a)
  expect(first.write).toHaveBeenCalledWith('only-a'); expect(second.write).not.toHaveBeenCalled()
  handler.onDisconnect(a)
  expect(first.kill).toHaveBeenCalledTimes(1); expect(second.kill).not.toHaveBeenCalled()
  handler.onFrame({ channel: 'docker:exec:in', execId: 'same', data: 'still-b' }, send, b)
  expect(second.write).toHaveBeenCalledWith('still-b')
  handler.onDisconnect(b); expect(second.kill).toHaveBeenCalledTimes(1)
})
