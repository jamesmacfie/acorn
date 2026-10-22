import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sandboxHeaders } from './headers.mts'

const NONCE = 'd1a01ee1-0f3b-4e02-8402-cedcb4d84d02'
// The SHA-256 of no bytes, in the label packages/client-core/src/host/tree/bundleLabel.test.ts pins.
const EMPTY_LABEL = '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'
const script = readFileSync(new URL('./worker-host.js', import.meta.url), 'utf8')

type Listener = (event: unknown) => void | Promise<void>

/** Runs the relay's script as a page named `label`, and returns what it did. */
function openRelay(label: string) {
  const parent = { postMessage: vi.fn() }
  let onMessage: Listener = () => {}
  const workers: { url: string; options: unknown; postMessage: ReturnType<typeof vi.fn> }[] = []
  class FakeWorker {
    onerror: unknown
    onmessageerror: unknown
    postMessage = vi.fn()
    constructor(url: string, options: unknown) {
      workers.push({ url, options, postMessage: this.postMessage })
    }
  }
  vi.stubGlobal('location', { hash: `#${NONCE}`, hostname: `${label}.sandbox.test` })
  vi.stubGlobal('window', { parent, addEventListener: (_: string, listener: Listener) => (onMessage = listener) })
  vi.stubGlobal('Worker', FakeWorker)
  new Function(script)()
  const start = async (overrides: Record<string, unknown> = {}, source: unknown = parent) => {
    const ports = [{}, {}]
    await onMessage({
      source,
      ports,
      data: {
        kind: 'acorn:tree-relay-start',
        nonce: NONCE,
        hello: { acornBridge: 1 },
        bundle: new ArrayBuffer(0),
        ...overrides,
      },
    })
    return ports
  }
  return { parent, workers, start }
}

afterEach(() => vi.unstubAllGlobals())

describe('the sandbox relay page', () => {
  it('says it is ready without carrying anything the parent could not already know', () => {
    const { parent } = openRelay(EMPTY_LABEL)
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: 'acorn:tree-relay-ready', nonce: NONCE }, '*')
  })

  it('starts a module worker from bytes that hash to its own label and hands it the ports', async () => {
    const { workers, start } = openRelay(EMPTY_LABEL)
    const ports = await start()
    expect(workers).toHaveLength(1)
    expect(workers[0]!.url).toMatch(/^blob:/)
    expect(workers[0]!.options).toEqual({ type: 'module' })
    expect(workers[0]!.postMessage).toHaveBeenCalledExactlyOnceWith({ acornBridge: 1 }, ports)
  })

  it('refuses bytes that do not hash to its label', async () => {
    const { parent, workers, start } = openRelay(EMPTY_LABEL)
    await start({ bundle: new Uint8Array([1]).buffer })
    expect(workers).toHaveLength(0)
    expect(parent.postMessage).toHaveBeenLastCalledWith({ kind: 'acorn:tree-relay-error', nonce: NONCE }, '*')
  })

  it('refuses a label that is not the canonical spelling of the hash', async () => {
    // The same 256 bits with a different last character: its four unused bits are not zero.
    const { workers, start } = openRelay(`${EMPTY_LABEL.slice(0, -1)}r`)
    await start()
    expect(workers).toHaveLength(0)
  })

  it.each([
    ['another window', {}, {}],
    ['another nonce', { nonce: 'other' }, undefined],
    ['another bridge version', { hello: { acornBridge: 2 } }, undefined],
    ['no bytes', { bundle: undefined }, undefined],
  ])('ignores a start from %s', async (_name, overrides, source) => {
    const { parent, workers, start } = openRelay(EMPTY_LABEL)
    await start(overrides, source)
    expect(workers).toHaveLength(0)
    expect(parent.postMessage).toHaveBeenCalledOnce()
  })

  it('starts one worker however many times it is asked', async () => {
    const { workers, start } = openRelay(EMPTY_LABEL)
    await Promise.all([start(), start()])
    await start()
    expect(workers).toHaveLength(1)
  })
})

describe('the sandbox headers', () => {
  it('give the page and its worker no network and no way to start anything but a blob worker', () => {
    const policy = Object.fromEntries(
      sandboxHeaders['content-security-policy'].split('; ').map((directive) => directive.split(/ (.*)/s)),
    )
    expect(policy).toMatchObject({
      'default-src': "'none'",
      'connect-src': "'none'",
      'script-src': "'self'",
      'worker-src': 'blob:',
      'frame-src': "'none'",
    })
  })
})
