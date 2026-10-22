import { afterEach, expect, it, vi } from 'vitest'
import { pluginFrameOrigin } from './sandboxOrigin'

// The SHA-256 of no bytes, and its label in ./bundleLabel.test.ts.
const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const LABEL = '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'

afterEach(() => vi.unstubAllGlobals())

it("is the desktop's plugin scheme for the desktop's renderer, with or without a sandbox domain", () => {
  expect(pluginFrameOrigin(HASH, 'app://acorn')).toBe(`app-plugin://${HASH}`)
  vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
  expect(pluginFrameOrigin(HASH, 'app://acorn')).toBe(`app-plugin://${HASH}`)
})

it("is the bundle's name under the sandbox domain for the phone app", () => {
  vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
  expect(pluginFrameOrigin(HASH, 'https://phone.example')).toBe(`https://${LABEL}.sandbox.test`)
})
