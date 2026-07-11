import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiSettingsStore, DEFAULT_API_PORT } from './settingsStore'

describe('ApiSettingsStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-api-settings-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to disabled on DEFAULT_API_PORT when no file exists', () => {
    const store = new ApiSettingsStore(dir, {})
    const eff = store.read()
    expect(eff.settings).toEqual({ enabled: false, port: DEFAULT_API_PORT })
    expect(eff.bindAddress).toBe(`127.0.0.1:${DEFAULT_API_PORT}`)
    expect(eff.portOverridden).toBe(false)
  })

  it('round-trips a write atomically', () => {
    const store = new ApiSettingsStore(dir, {})
    store.write({ enabled: true, port: 4319 })
    const eff = new ApiSettingsStore(dir, {}).read()
    expect(eff.settings).toEqual({ enabled: true, port: 4319 })
  })

  it('rejects the reserved app port 4317', () => {
    const store = new ApiSettingsStore(dir, {})
    expect(() => store.write({ port: 4317 })).toThrow(/reserved/)
  })

  it('fails closed to disabled on a corrupt file and surfaces an error', () => {
    writeFileSync(join(dir, 'api-settings.json'), '{ not json')
    const eff = new ApiSettingsStore(dir, {}).read()
    expect(eff.settings.enabled).toBe(false)
    expect(eff.error).toMatch(/invalid/)
  })

  it('fails closed on an unknown version', () => {
    writeFileSync(join(dir, 'api-settings.json'), JSON.stringify({ version: 2, enabled: true, port: 4319 }))
    const eff = new ApiSettingsStore(dir, {}).read()
    expect(eff.settings.enabled).toBe(false)
    expect(eff.error).toBeDefined()
  })

  it('applies ACORN_API_PORT as a read-only override', () => {
    const store = new ApiSettingsStore(dir, { ACORN_API_PORT: '4320' })
    store.write({ enabled: true, port: 4319 })
    const eff = store.read()
    expect(eff.settings.port).toBe(4319) // stored value unchanged
    expect(eff.effectivePort).toBe(4320) // override wins
    expect(eff.portOverridden).toBe(true)
    expect(eff.bindAddress).toBe('127.0.0.1:4320')
  })

  it('ignores an invalid ACORN_API_PORT override', () => {
    const store = new ApiSettingsStore(dir, { ACORN_API_PORT: 'nope' })
    expect(store.read().portOverridden).toBe(false)
  })
})
