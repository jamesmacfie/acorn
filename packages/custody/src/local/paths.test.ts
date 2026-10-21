import { afterEach, expect, it, vi } from 'vitest'
import { configDir } from './public'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('keeps client tokens where ACORN_TUI_CONFIG_DIR says', () => {
  vi.stubEnv('ACORN_TUI_CONFIG_DIR', '/tmp/acorn-client')
  expect(configDir()).toBe('/tmp/acorn-client')
  vi.stubEnv('ACORN_TUI_CONFIG_DIR', '')
  expect(configDir()).toMatch(/acorn$/)
})
