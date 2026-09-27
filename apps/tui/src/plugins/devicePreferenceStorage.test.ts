import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installDevicePreferenceStorage } from './devicePreferenceStorage'

const original = process.env.ACORN_TUI_CONFIG_DIR
let dir = ''
afterEach(() => {
  if (original === undefined) delete process.env.ACORN_TUI_CONFIG_DIR
  else process.env.ACORN_TUI_CONFIG_DIR = original
  delete (globalThis as { localStorage?: Storage }).localStorage
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('terminal device preferences', () => {
  it('survives a fresh host instance without writing to a node', () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-tui-device-prefs-'))
    process.env.ACORN_TUI_CONFIG_DIR = dir
    installDevicePreferenceStorage()
    localStorage.setItem('acorn-pref:acorn-1:device_plugins_disabled', '["board"]')
    expect(JSON.parse(readFileSync(join(dir, 'device-prefs.json'), 'utf8'))).toMatchObject({
      'acorn-pref:acorn-1:device_plugins_disabled': '["board"]',
    })
    installDevicePreferenceStorage()
    expect(localStorage.getItem('acorn-pref:acorn-1:device_plugins_disabled')).toBe('["board"]')
  })
})
