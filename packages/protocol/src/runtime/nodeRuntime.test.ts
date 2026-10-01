import { expect, it } from 'vitest'
import { assertSupportedNodeRuntime, isSupportedNodeRuntime } from './nodeRuntime'

it.each(['22.23.2', '22.24.0', '24.18.1', '24.21.0', '26.5.1', '26.10.0'])(
  'accepts patched Node %s in a supported branch', (version) => {
    expect(isSupportedNodeRuntime(version)).toBe(true)
    expect(() => assertSupportedNodeRuntime(version)).not.toThrow()
  },
)

it.each([
  '22.23.1', '22.22.99', '24.18.0', '24.11.0', '26.5.0', '26.4.99',
  '20.99.0', '23.99.0', '25.99.0', '27.0.0', '28.99.0',
  '24.21.0-rc.1', 'v24.21.0', '24.21', '24.21.0\n', '',
])('refuses insecure, unsupported, or malformed Node %s', (version) => {
  expect(isSupportedNodeRuntime(version)).toBe(false)
  expect(() => assertSupportedNodeRuntime(version)).toThrow('Upgrade Node before loading plugins')
})
