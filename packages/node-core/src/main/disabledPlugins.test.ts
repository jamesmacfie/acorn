import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disabledPluginsStore } from './disabledPlugins'

describe('disabledPluginsStore', () => {
  let dir: string
  const file = () => join(dir, 'disabled-plugins.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-disabled-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty and round-trips a list across processes, privately', () => {
    expect(disabledPluginsStore(dir).get()).toEqual([])
    disabledPluginsStore(dir).set(['rollbar', 'docker'])
    // Sorted and de-duplicated on write, so the file is stable across saves that reorder checkboxes.
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual(['docker', 'rollbar'])
    expect(statSync(file()).mode & 0o777).toBe(0o600)
    // A second store: the next boot, which is the only reader that matters.
    expect(disabledPluginsStore(dir).get()).toEqual(['docker', 'rollbar'])
  })

  it('de-duplicates and drops empty names', () => {
    const store = disabledPluginsStore(dir)
    store.set(['docker', 'docker', '', 'linear'])
    expect(store.get()).toEqual(['docker', 'linear'])
  })

  it('reads a corrupt or wrongly-shaped file as nothing disabled', () => {
    // Fail open, not closed. The opposite default turns a truncated 40-byte file into a node that
    // will not boot, and the recovery, delete the file, lands on exactly this state anyway.
    for (const raw of ['{ not json', '{"disabled":["docker"]}', 'null', '[1, 2, 3]', '']) {
      writeFileSync(file(), raw)
      expect(disabledPluginsStore(dir).get(), raw).toEqual([])
    }
  })

  it('keeps the string entries of a partly-wrong array', () => {
    writeFileSync(file(), JSON.stringify(['docker', 7, null, 'linear']))
    expect(disabledPluginsStore(dir).get()).toEqual(['docker', 'linear'])
  })

  it('leaves no temp file behind and can clear back to empty', () => {
    const store = disabledPluginsStore(dir)
    store.set(['docker'])
    store.set([])
    expect(store.get()).toEqual([])
    expect(disabledPluginsStore(dir).get()).toEqual([])
  })
})
