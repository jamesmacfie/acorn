import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), docker: vi.fn(), env: vi.fn(() => ({})) }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }))
vi.mock('./cli', () => ({ docker: mocks.docker, dockerEnv: mocks.env, DockerCliError: class extends Error {} }))
import { disposeDocker, getDockerService } from './dockerService'
import { SharedDockerStreams } from './sharedStreams'

class Child extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => { this.emit('close'); return true })
}
const children: Child[] = []
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  mocks.spawn.mockImplementation(() => { const child = new Child(); children.push(child); return child })
  mocks.docker.mockResolvedValue('')
})
afterEach(() => {
  disposeDocker()
  children.splice(0)
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('joins sixteen cold health readers and preserves the settled TTL', async () => {
  mocks.docker.mockResolvedValue('{"Server":{"Version":"fixture"}}')
  const service = getDockerService()
  const values = await Promise.all(Array.from({ length: 16 }, () => service.info()))
  expect(values.every(value => value.available)).toBe(true)
  expect(mocks.docker).toHaveBeenCalledTimes(1)
  await service.info()
  expect(mocks.docker).toHaveBeenCalledTimes(1)
  expect(mocks.spawn).toHaveBeenCalledTimes(1)
})

it('returns held health honestly without publishing or starting a watcher after disposal', async () => {
  const held = deferred<string>()
  mocks.docker.mockReturnValue(held.promise)
  const service = getDockerService()
  const read = service.info()
  service.dispose()
  held.resolve('{"Server":{"Version":"fixture"}}')
  expect(await read).toMatchObject({ available: true })
  expect(mocks.spawn).not.toHaveBeenCalled()
})

it('fences invalidated inventory and its finally against a replacement wave', async () => {
  const old = deferred<string>(), fresh = deferred<string>()
  mocks.docker.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  const service = getDockerService()
  const a = service.containers()
  service.invalidate('containers')
  const b = service.containers()
  old.resolve('{"ID":"old","Names":"old","Image":"fixture"}')
  expect(await a).toMatchObject([{ id: 'old' }])
  const joined = service.containers()
  expect(mocks.docker).toHaveBeenCalledTimes(2)
  fresh.resolve('{"ID":"fresh","Names":"fresh","Image":"fixture"}')
  expect(await b).toMatchObject([{ id: 'fresh' }])
  expect(await joined).toEqual(await b)
  expect(await service.containers()).toEqual(await b)
})

it('drains output after exit and ends once at close; stop suppresses end', () => {
  const end = vi.fn(), output = vi.fn()
  const service = getDockerService()
  service.openStream('logs', 'fixture', output, end)
  const child = children.at(-1)!
  child.emit('exit', 0)
  child.stdout.write('after exit')
  child.stderr.write('stderr')
  expect(output.mock.calls.map(call => call[0])).toEqual(['after exit', 'stderr'])
  expect(end).not.toHaveBeenCalled()
  child.emit('close', 0)
  child.emit('error', new Error('late'))
  expect(end).toHaveBeenCalledTimes(1)
  const stopped = service.openStream('stats', 'fixture', output, end)
  stopped.stop(); stopped.stop()
  service.dispose()
  expect(end).toHaveBeenCalledTimes(1)
})

it('settles real missing-binary errors through shared producers and admits a healthy replacement', async () => {
  const original = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  mocks.spawn.mockImplementation((command, args) => original.spawn(command, args, { env: { PATH: '/acorn-unit19-no-binaries' } }))
  const service = getDockerService()
  const shared = new SharedDockerStreams(service)
  const frames = vi.fn(), end = vi.fn()
  const completions = Array.from({ length: 32 }, (_, index) => new Promise<void>(resolve => {
    shared.attach('logs', `fixture-${index}`, frames, () => { end(); resolve() })
  }))
  await Promise.all(completions)
  expect(end).toHaveBeenCalledTimes(32)
  expect(frames.mock.calls.filter(([frame]) => frame.channel === 'docker:stream-end')).toHaveLength(32)
  mocks.spawn.mockImplementation(() => { const child = new Child(); children.push(child); return child })
  const first = shared.attach('logs', 'fixture-0', frames, end)
  const second = shared.attach('logs', 'fixture-0', frames, end)
  expect(first.active && second.active).toBe(true)
  children.at(-1)!.stdout.write('healthy')
  expect(frames.mock.calls.filter(([frame]) => frame.data === 'healthy')).toHaveLength(2)
  first.stop()
  expect(children.at(-1)!.kill).not.toHaveBeenCalled()
  second.stop()
  expect(children.at(-1)!.kill).toHaveBeenCalledTimes(1)
})

it('retries one failed watcher and ignores late cleanup from its predecessor', async () => {
  vi.useFakeTimers()
  const broadcast = vi.fn(), service = getDockerService(broadcast)
  await service.containers()
  const old = children[0]
  old.emit('error', new Error('failed'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(children).toHaveLength(2)
  old.emit('close')
  children[1].stdout.write('{"Type":"container"}\n')
  await vi.advanceTimersByTimeAsync(300)
  expect(broadcast).toHaveBeenCalledTimes(1)
  service.dispose()
  old.emit('close')
  children[1].emit('error', new Error('late'))
  await vi.advanceTimersByTimeAsync(60000)
  expect(children).toHaveLength(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('recovers after synchronous spawn failure and suppresses disposal callbacks', async () => {
  mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn') })
  const service = getDockerService(), end = vi.fn()
  service.openStream('logs', 'fixture', vi.fn(), end)
  await Promise.resolve()
  expect(end).toHaveBeenCalledTimes(1)
  service.openStream('logs', 'healthy', vi.fn(), end)
  service.dispose(); service.dispose()
  expect(end).toHaveBeenCalledTimes(1)
})

it('ends refused subscriptions and lets intentional stop suppress their queued end', async () => {
  const service = getDockerService(), end = vi.fn()
  service.dispose()
  const shared = new SharedDockerStreams(service)
  const subscription = shared.attach('logs', 'refused', vi.fn(), end)
  const stopped = shared.attach('logs', 'stopped', vi.fn(), end)
  stopped.stop()
  await Promise.resolve()
  expect(subscription.active).toBe(false)
  expect(end).toHaveBeenCalledTimes(1)
})
