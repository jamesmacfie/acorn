import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { coreStateSlices } from '@acorn/client-core/persistence/stateSlices.ts'
import { directPreferenceSlices } from '@acorn/client-core/persistence/preferenceSlices.ts'
import { stringifyPersistedValue, utf8Bytes, type PersistedStateSlice } from '@acorn/client-core/persistence/persistedState.ts'
import { contextSelectionSlice } from '@acorn/plugin-context/client/selectionSlice.ts'
import { dockerPrefsSlice } from '@acorn/plugin-docker/client/dockerPrefs.ts'
import { editorOpenFilesSlice } from '@acorn/plugin-editor/client/openFilesSlice.ts'
import { prFiltersSlice } from '@acorn/plugin-github/client/pullList/filterSlice.ts'

// The four plugin slices are enumerated HERE rather than read off persistedStateRegistry, and that is a
// consequence of the ClientPlugin conversion worth stating: each plugin registers its own slice in its
// client/index.ts now, so the only way to see the assembled set is to activate the plugins — and
// activating them imports .tsx modules, which this vitest setup cannot transform (no vite-plugin-solid,
// deliberately: a green suite here must not imply anything about rendered UI). The completeness check
// below is what stops the list from silently going stale.
const pluginSlices: readonly PersistedStateSlice<unknown>[] = [
  editorOpenFilesSlice,
  prFiltersSlice,
  contextSelectionSlice,
  dockerPrefsSlice,
] as readonly PersistedStateSlice<unknown>[]

const slices: readonly PersistedStateSlice<unknown>[] = [
  ...coreStateSlices,
  ...pluginSlices,
  ...directPreferenceSlices,
] as readonly PersistedStateSlice<unknown>[]

const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

describe('persisted-state descriptor conformance', () => {
  it('covers every slice a plugin registers', () => {
    // Text-matched over the plugin entrypoints, the same technique tools/arch/boundaries.test.ts uses:
    // a plugin that adds `ctx.persistedState.register(...)` without adding its slice above fails here
    // instead of shipping a descriptor nothing ever checked.
    const pluginsDir = join(ROOT, 'plugins')
    const registered = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const index = join(pluginsDir, entry.name, 'src/client/index.ts')
        if (!existsSync(index)) return []
        return [...readFileSync(index, 'utf8').matchAll(/ctx\.persistedState\.register\(/g)].map(() => entry.name)
      })
    expect(registered.length).toBe(pluginSlices.length)
  })

  it('has unique identities and bounded, valid descriptor metadata', () => {
    expect(new Set(slices.map((slice) => slice.id)).size).toBe(slices.length)
    expect(new Set(slices.map((slice) => slice.key)).size).toBe(slices.length)
    for (const slice of slices) {
      expect(slice.id).toMatch(/^[a-z0-9.-]+$/)
      expect(slice.version).toBeGreaterThan(0)
      expect(slice.maxBytes).toBeGreaterThan(0)
    }
  })

  for (const slice of slices) {
    it(`${slice.id} tolerates malformed/legacy-shaped input and round-trips its empty value`, () => {
      expect(() => slice.codec.parse('{not-json')).not.toThrow()
      expect(() => slice.codec.parse({ unknown: { future: true } })).not.toThrow()
      const empty = slice.empty('conformance-scope')
      const encoded = stringifyPersistedValue(slice, empty)
      expect(() => slice.codec.parse(encoded)).not.toThrow()
      expect(utf8Bytes(encoded)).toBeLessThanOrEqual(slice.maxBytes!)
      // Oversize payloads are rejected by startupRestore before hydration; codecs must still fail
      // closed rather than throw if called directly by a future migration.
      expect(() => slice.codec.parse('x'.repeat(slice.maxBytes! + 1))).not.toThrow()
    })
  }
})
