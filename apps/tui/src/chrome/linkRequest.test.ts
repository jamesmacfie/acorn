import { describe, expect, it, vi } from 'vitest'
import { startLinkRequest } from './linkRequest'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('deferred terminal link request', () => {
  it('does not apply a loaded destination after its shell is disposed or its Node changes', async () => {
    const outgoing = deferred<string>()
    const switched = deferred<string>()
    const apply = vi.fn()
    let currentNodeId = 'node-1'
    const request = (load: () => Promise<string>) => startLinkRequest({
      load, apply, currentNodeId: () => currentNodeId, nodeId: 'node-1', onError: vi.fn(),
    })

    const cancel = request(() => outgoing.promise)
    cancel()
    outgoing.resolve('outgoing place')
    await outgoing.promise

    request(() => switched.promise)
    currentNodeId = 'node-2'
    switched.resolve('old Node place')
    await switched.promise
    expect(apply).not.toHaveBeenCalled()
  })

  it('reports a live import rejection without an unhandled promise', async () => {
    const failure = deferred<unknown>()
    const onError = vi.fn()
    startLinkRequest({
      load: () => failure.promise, apply: vi.fn(), currentNodeId: () => 'node-1',
      nodeId: 'node-1', onError,
    })
    const error = new Error('missing chunk')
    failure.reject(error)
    await failure.promise.catch(() => undefined)
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith(error)
  })
})
