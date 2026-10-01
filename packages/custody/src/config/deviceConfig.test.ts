import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeviceConfigStore } from './deviceConfig'

const directories: string[] = []
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'acorn-config-'))
  directories.push(directory)
  return new DeviceConfigStore(directory)
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('device config file', () => {
  it('preserves unknown keys during a Settings write', () => {
    const store = fixture()
    writeFileSync(store.path, '{"style":"terminal","future":{"enabled":true}}')
    expect(store.read().config.style).toBe('terminal')
    store.write({ style: 'modern' })
    expect(JSON.parse(readFileSync(store.path, 'utf8'))).toEqual({ style: 'modern', future: { enabled: true } })
  })

  it('keeps the last valid state and reports the parse location', () => {
    const store = fixture()
    store.write({ style: 'modern' })
    writeFileSync(store.path, '{\n  "style": "cute",\n  broken\n}')
    const state = store.read()
    expect(state.config.style).toBe('modern')
    expect(state.error?.line).toBe(3)
    expect(state.error?.column).toBeGreaterThan(0)
    const malformed = readFileSync(store.path, 'utf8')
    expect(() => store.write({ theme: 'dark' })).toThrow('parse error is fixed')
    expect(readFileSync(store.path, 'utf8')).toBe(malformed)
  })
})
