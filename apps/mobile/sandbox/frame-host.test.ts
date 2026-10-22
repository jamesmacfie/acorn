import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const NONCE = 'd1a01ee1-0f3b-4e02-8402-cedcb4d84d02'
// The SHA-256 of no bytes, in the label packages/client-core/src/host/tree/bundleLabel.test.ts pins.
const EMPTY_LABEL = '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'
const script = ['bundle-check.js', 'frame-host.js']
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))
  .join('\n')

type Listener = (event: unknown) => void | Promise<void>

/** Runs the frame page's scripts as a page named `label`, and returns what it told its parent. */
function openFramePage(label: string) {
  const parent = { postMessage: vi.fn() }
  let onMessage: Listener = () => {}
  vi.stubGlobal('location', { hash: `#${NONCE}`, hostname: `${label}.sandbox.test` })
  vi.stubGlobal('window', { parent, addEventListener: (_: string, listener: Listener) => (onMessage = listener) })
  new Function(script)()
  const send = (overrides: Record<string, unknown> = {}, source: unknown = parent) =>
    onMessage({ source, data: { kind: 'acorn:frame-bundle', nonce: NONCE, bundle: new ArrayBuffer(0), ...overrides } })
  return { parent, send }
}

afterEach(() => vi.unstubAllGlobals())

describe('the frame page', () => {
  it('says it is ready without carrying anything the parent could not already know', () => {
    const { parent } = openFramePage(EMPTY_LABEL)
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: 'acorn:frame-ready', nonce: NONCE }, '*')
  })

  it('refuses bytes that do not hash to its label, and tells the parent', async () => {
    const { parent, send } = openFramePage(EMPTY_LABEL)
    await send({ bundle: new Uint8Array([1]).buffer })
    expect(parent.postMessage).toHaveBeenLastCalledWith({ kind: 'acorn:frame-error', nonce: NONCE }, '*')
  })

  it('refuses a label that is not the canonical spelling of the hash', async () => {
    const { parent, send } = openFramePage(`${EMPTY_LABEL.slice(0, -1)}r`)
    await send()
    expect(parent.postMessage).toHaveBeenLastCalledWith({ kind: 'acorn:frame-error', nonce: NONCE }, '*')
  })

  it.each([
    ['another window', {}, {}],
    ['another nonce', { nonce: 'other' }, undefined],
    ['no bytes', { bundle: undefined }, undefined],
  ])('ignores a bundle from %s', async (_name, overrides, source) => {
    const { parent, send } = openFramePage(EMPTY_LABEL)
    await send(overrides, source)
    expect(parent.postMessage).toHaveBeenCalledOnce()
  })

  it('takes one bundle however many times it is sent one', async () => {
    const { parent, send } = openFramePage(EMPTY_LABEL)
    await Promise.all([send({ bundle: new Uint8Array([1]).buffer }), send()])
    await send()
    // The ready message, and one verdict.
    expect(parent.postMessage).toHaveBeenCalledTimes(2)
  })
})
