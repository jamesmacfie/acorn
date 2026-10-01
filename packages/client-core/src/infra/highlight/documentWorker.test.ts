import { afterEach, expect, it, vi } from 'vitest'
import { createDocumentWorker } from './documentWorker'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
class FixtureWorker {
  static instances: FixtureWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn((_message: { id: number; code: string }) => {})
  terminate = vi.fn()
  constructor() { FixtureWorker.instances.push(this) }
}
function mount(load = async () => ({ default: FixtureWorker as unknown as new () => Worker })) {
  FixtureWorker.instances = []; vi.stubGlobal('Worker', FixtureWorker)
  return createDocumentWorker<{ id: number; code: string }, { id: number; value: string; ok?: boolean }, string>({
    load, response: (message) => message.ok === false ? { kind: 'fallback' } : { kind: 'value', value: message.value },
  })
}
const read = (owner: ReturnType<typeof mount>, code = 'source') => owner.request((id) => ({ id, code }))
it('settles a held import on reset and cannot construct from its retired continuation', async () => {
  vi.useFakeTimers(); const imported = deferred<{ default: new () => Worker }>(); const owner = mount(() => imported.promise)
  const first = read(owner); owner.reset()
  expect(await first).toEqual({ kind: 'degraded' }); expect(vi.getTimerCount()).toBe(0)
  imported.resolve({ default: FixtureWorker as unknown as new () => Worker }); await Promise.resolve(); await Promise.resolve()
  expect(FixtureWorker.instances).toHaveLength(0)
})
it('bounds the entire held import wave and keeps its retired calls off the renderer', async () => {
  vi.useFakeTimers(); const imported = deferred<{ default: new () => Worker }>(); const load = vi.fn(() => imported.promise)
  const owner = mount(load); const reads = [read(owner), read(owner)]
  await vi.advanceTimersByTimeAsync(10_000)
  expect(await Promise.all(reads)).toEqual([{ kind: 'degraded' }, { kind: 'degraded' }]); expect(load).toHaveBeenCalledTimes(1)
  expect(await read(owner)).toEqual({ kind: 'degraded' }); expect(vi.getTimerCount()).toBe(0)
  imported.resolve({ default: FixtureWorker as unknown as new () => Worker }); await Promise.resolve(); await Promise.resolve()
  expect(FixtureWorker.instances).toHaveLength(0)
})
it('settles every request and clears deadlines when the live worker is blocked', async () => {
  vi.useFakeTimers(); const owner = mount(); const reads = [read(owner), read(owner)]
  await vi.advanceTimersByTimeAsync(0); const worker = FixtureWorker.instances[0]
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(10_000)
  expect((await Promise.all(reads)).map((r) => r.kind)).toEqual(['degraded', 'degraded'])
  expect(worker.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  await read(owner); expect(worker.postMessage).toHaveBeenCalledTimes(2)
})
it('old messages and errors cannot settle or kill a replacement', async () => {
  const owner = mount(); const first = read(owner); await Promise.resolve(); await Promise.resolve()
  const old = FixtureWorker.instances[0]; const oldMessage = old.onmessage!, oldError = old.onerror!
  owner.reset(); expect(await first).toEqual({ kind: 'degraded' })
  const next = read(owner, 'replacement'); await Promise.resolve(); await Promise.resolve()
  const replacement = FixtureWorker.instances[1]; const request = replacement.postMessage.mock.calls[0][0]
  oldMessage({ data: { id: request.id, value: 'obsolete' } } as MessageEvent); oldError()
  expect(replacement.terminate).not.toHaveBeenCalled()
  replacement.onmessage!({ data: { id: request.id, value: 'replacement' } } as MessageEvent)
  expect(await next).toEqual({ kind: 'value', value: 'replacement' }); owner.reset()
})
it.each(['import', 'constructor', 'postMessage', 'script'] as const)('settles infrastructure %s failure with ordinary fallback', async (phase) => {
  const owner = mount(phase === 'import' ? async () => { throw new Error('fixture') } : async () => ({ default:
    (phase === 'constructor' ? class { constructor() { throw new Error('fixture') } } : FixtureWorker) as unknown as new () => Worker }))
  const result = read(owner); await Promise.resolve(); await Promise.resolve()
  const worker = FixtureWorker.instances[0]
  if (phase === 'script') worker.onerror!()
  if (phase === 'postMessage') { owner.reset(); await result
    const second = mount(async () => ({ default: class extends FixtureWorker { postMessage = vi.fn(() => { throw new Error('fixture') }) } as unknown as new () => Worker }))
    expect(await read(second)).toEqual({ kind: 'fallback' }); second.reset(); return }
  expect(await result).toEqual({ kind: 'fallback' }); owner.reset()
})
it('keeps per-document grammar failure separate from worker retirement', async () => {
  const owner = mount(); const first = read(owner); await Promise.resolve(); await Promise.resolve()
  const worker = FixtureWorker.instances[0], id = worker.postMessage.mock.calls[0][0].id
  worker.onmessage!({ data: { id, ok: false } } as MessageEvent); expect(await first).toEqual({ kind: 'fallback' })
  const second = read(owner); await Promise.resolve(); await Promise.resolve()
  worker.onmessage!({ data: { id: worker.postMessage.mock.calls[1][0].id, value: 'healthy' } } as MessageEvent)
  expect(await second).toEqual({ kind: 'value', value: 'healthy' }); expect(worker.terminate).not.toHaveBeenCalled(); owner.reset()
})
