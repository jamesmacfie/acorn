// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIsolatedTreeWorker, pluginTreeRelayOrigin } from './isolatedWorker'
import { setBundleSource } from './sandboxOrigin'

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const NONCE = 'd1a01ee1-0f3b-4e02-8402-cedcb4d84d02'

const LABEL = '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

afterEach(() => {
  setBundleSource(null)
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
      window.dispatchEvent(
        new MessageEvent('message', { origin, source, data: { kind: 'acorn:tree-relay-ready', nonce } }),
      )
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
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: `app-plugin://${HASH}`,
        source: frame.contentWindow,
        data: { kind: 'acorn:tree-relay-error', nonce: NONCE },
      }),
    )
    expect(failed).toHaveBeenCalledOnce()
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('isolated tree worker relay on the phone', () => {
  const PHONE = 'https://phone.example'
  const readyFrom = (frame: HTMLIFrameElement, origin: string) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        source: frame.contentWindow,
        data: { kind: 'acorn:tree-relay-ready', nonce: NONCE },
      }),
    )

  it('names one origin per bundle under the sandbox domain', () => {
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
    expect(pluginTreeRelayOrigin(EMPTY_HASH, PHONE)).toBe(`https://${LABEL}.sandbox.test`)
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.localhost:4322')
    expect(pluginTreeRelayOrigin(EMPTY_HASH, PHONE)).toBe(`http://${LABEL}.sandbox.localhost:4322`)
    expect(pluginTreeRelayOrigin(EMPTY_HASH, 'app://acorn')).toBe(`app-plugin://${EMPTY_HASH}`)
  })

  it('refuses a renderer it does not know when the build has no sandbox domain', () => {
    expect(() => pluginTreeRelayOrigin(EMPTY_HASH, PHONE)).toThrow('unknown renderer origin')
  })

  it('posts the bundle and the ports only to the exact relay origin after its ready message', async () => {
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
    vi.stubGlobal('crypto', { randomUUID: () => NONCE })
    const bytes = new TextEncoder().encode('export {}').buffer
    setBundleSource(async (hash) => (hash === EMPTY_HASH ? bytes : new ArrayBuffer(0)))
    const sandbox = createIsolatedTreeWorker(EMPTY_HASH, PHONE)
    const frame = document.querySelector('iframe')!
    expect(frame.src).toBe(`https://${LABEL}.sandbox.test/worker.html#${NONCE}`)
    const deliver = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    const ports = [new MessageChannel().port1, new MessageChannel().port1]
    sandbox.postMessage({ acornBridge: 1 }, ports)

    readyFrom(frame, 'https://other.sandbox.test')
    expect(deliver).not.toHaveBeenCalled()

    readyFrom(frame, `https://${LABEL}.sandbox.test`)
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce())
    expect(deliver).toHaveBeenCalledWith(
      { kind: 'acorn:tree-relay-start', nonce: NONCE, hello: { acornBridge: 1 }, bundle: bytes },
      `https://${LABEL}.sandbox.test`,
      ports,
    )
    sandbox.terminate()
  })

  it('fails closed when the device has no source for the bytes', () => {
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
    vi.stubGlobal('crypto', { randomUUID: () => NONCE })
    const sandbox = createIsolatedTreeWorker(EMPTY_HASH, PHONE)
    const frame = document.querySelector('iframe')!
    const failed = vi.fn()
    sandbox.onerror = failed
    const ports = [new MessageChannel().port1, new MessageChannel().port1]
    const closed = vi.spyOn(ports[0]!, 'close')
    sandbox.postMessage({ acornBridge: 1 }, ports)
    readyFrom(frame, `https://${LABEL}.sandbox.test`)
    expect(failed).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('fails closed when the source cannot read the bundle', async () => {
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
    vi.stubGlobal('crypto', { randomUUID: () => NONCE })
    setBundleSource(() => Promise.reject(new Error('gone')))
    const sandbox = createIsolatedTreeWorker(EMPTY_HASH, PHONE)
    const frame = document.querySelector('iframe')!
    const failed = vi.fn()
    sandbox.onerror = failed
    sandbox.postMessage({ acornBridge: 1 }, [new MessageChannel().port1, new MessageChannel().port1])
    readyFrom(frame, `https://${LABEL}.sandbox.test`)
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
  })
})
