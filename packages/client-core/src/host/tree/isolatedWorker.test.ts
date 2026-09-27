// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIsolatedTreeWorker } from './isolatedWorker'

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const NONCE = 'd1a01ee1-0f3b-4e02-8402-cedcb4d84d02'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isolated tree worker relay', () => {
  it('transfers ports only to the expected frame after source, origin and nonce match', () => {
    vi.stubGlobal('crypto', { randomUUID: () => NONCE })
    const sandbox = createIsolatedTreeWorker(HASH, 'app://acorn')
    const frame = document.querySelector('iframe')!
    expect(frame.src).toBe(`app-plugin://${HASH}/worker.html#${NONCE}`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    const deliver = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    const ports = [new MessageChannel().port1, new MessageChannel().port1]
    sandbox.postMessage({ acornBridge: 1 }, ports)

    const ready = (origin: string, nonce: string, source: MessageEventSource | null) =>
      window.dispatchEvent(new MessageEvent('message', { origin, source, data: { kind: 'acorn:tree-relay-ready', nonce } }))
    ready(`app-plugin://${HASH}`, NONCE, window)
    ready('app://acorn', NONCE, frame.contentWindow)
    ready(`app-plugin://${HASH}`, 'wrong', frame.contentWindow)
    expect(deliver).not.toHaveBeenCalled()

    ready(`app-plugin://${HASH}`, NONCE, frame.contentWindow)
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      { kind: 'acorn:tree-relay-start', nonce: NONCE, hello: { acornBridge: 1 } },
      `app-plugin://${HASH}`,
      ports,
    )
    ready(`app-plugin://${HASH}`, NONCE, frame.contentWindow)
    expect(deliver).toHaveBeenCalledTimes(1)
    sandbox.terminate()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('fails closed when its own relay reports a worker error', () => {
    vi.stubGlobal('crypto', { randomUUID: () => NONCE })
    const sandbox = createIsolatedTreeWorker(HASH, 'app://acorn')
    const frame = document.querySelector('iframe')!
    const failed = vi.fn()
    sandbox.onerror = failed
    window.dispatchEvent(new MessageEvent('message', {
      origin: `app-plugin://${HASH}`,
      source: frame.contentWindow,
      data: { kind: 'acorn:tree-relay-error', nonce: NONCE },
    }))
    expect(failed).toHaveBeenCalledOnce()
    expect(document.querySelector('iframe')).toBeNull()
  })
})
