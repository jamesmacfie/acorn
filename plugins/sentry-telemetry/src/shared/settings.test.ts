import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings, PROVIDER_ID, SDK_VERSION } from './settings'

describe('parseSettings', () => {
  it('answers the defaults for anything that is not an object', () => {
    // The row is written by a sandboxed frame and read on a flush, so it has to answer rather than
    // throw whatever it finds.
    for (const raw of [null, undefined, 'nope', 42, []]) expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills in the fields a stored value does not have', () => {
    expect(parseSettings({ sampleRate: 0.5 })).toEqual({ ...DEFAULT_SETTINGS, sampleRate: 0.5 })
    expect(parseSettings({ kinds: { log: false } })).toEqual({
      ...DEFAULT_SETTINGS,
      kinds: { ...DEFAULT_SETTINGS.kinds, log: false },
    })
  })

  it('clamps a rate into nought to one', () => {
    expect(parseSettings({ sampleRate: 5 }).sampleRate).toBe(1)
    expect(parseSettings({ sampleRate: -1 }).sampleRate).toBe(0)
    expect(parseSettings({ sampleRate: Number.NaN }).sampleRate).toBe(1)
  })

  it('starts with everything on and nothing sampled away', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      sampleRate: 1,
      kinds: { span: true, log: true, event: true, metric: true, error: true },
      stacks: true,
      taskIds: true,
    })
  })
})

describe('the package identity', () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'))

  it('reports the version the package actually is', () => {
    // Every envelope carries `sdk.version`, and a bundle cannot read a package.json that is not
    // inside it, so the constant is written by hand and held here.
    expect(SDK_VERSION).toBe(packageJson.version)
  })

  it('uses the directory name as the plugin and provider id', () => {
    expect(packageJson.name).toBe(`@acorn/plugin-${PROVIDER_ID}`)
  })
})
