import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Does the facade load in a plugin's own test environment? See docs/plugins.md § The plugin API for
// the barrel/tier boundary this protects: a `.tsx` module anywhere behind an entrypoint dies on
// `window is not defined` in someone else's package the moment that plugin's suite imports it.
//
// This file loads every entrypoint in process, under vitest's node environment with no jsdom and no
// Solid transform, rather than spawning a child the way
// apps/node/test/integration/mainBarrelLoad.test.ts does: the hazard is what a vitest worker can
// load, so a vitest worker is the honest place to ask. It doubles as enforcement of
// "sideEffects": false in package.json, since a barrel doing real work at module scope (opening a
// database, reading a data root, registering into a live registry) would do it here too, in a test
// that passes nothing in and asserts only that names came back.
const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
  exports: Record<string, string>
}

// Derived from the exports map, not listed by hand: a new entrypoint is covered the day it is added,
// which is the difference between a property and an allowlist. The three below are excluded because
// they legitimately need a browser realm, and each says so in its own header:
const BROWSER_REALM = new Set([
  './ui', // frame-safe presentation components, .tsx, so Solid-compiled
  './ui/host', // registration and connected shell surfaces, also .tsx
  './ui/editor', // re-exports client-core/editor/theme.ts, which imports monaco-editor; monaco reads
  //                `window` at module scope (monaco-editor/esm/vs/base/browser/window.js). Its own
  //                header already explains that this is why it is a separate entrypoint; it is
  //                therefore not a node-safe one, and a plugin test that needs a Monaco theme cannot
  //                have it. Verified by loading it: it throws `window is not defined`.
])

const nodeSafe = Object.keys(PKG.exports).filter((entry) => !BROWSER_REALM.has(entry))

describe('plugin-api entrypoints load in a node environment', () => {
  // Anti-vacuity, and the reason to derive the list: an exports map that stopped parsing, or a
  // BROWSER_REALM that quietly swallowed the whole package, would make every assertion below vacuous.
  it('covers every entrypoint that is not deliberately browser-realm', () => {
    // `./testkit/client` is node-safe too: it is the client half of the test seam, but the suites that
    // import it are bare-node `*.test.ts` files like every other plugin suite, so a component finding
    // its way onto that barrel would make it unloadable by the tests it exists for. Its own header
    // states the rule; this is the check.
    expect(nodeSafe.sort()).toEqual(['./client', './node', './testkit', './testkit/client', './ui/diff', './ui/sdk'])
    expect([...BROWSER_REALM].every((entry) => entry in PKG.exports)).toBe(true)
  })

  for (const entry of nodeSafe) {
    const spec = `@acorn/plugin-api${entry.slice(1)}`
    it(`imports ${spec}`, async () => {
      // The bare specifier, not the relative path: it exercises the exports map a plugin actually
      // writes, so a mis-declared entrypoint fails here too. Node's self-reference resolution makes
      // the package able to name itself.
      const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>
      expect(Object.keys(mod).length).toBeGreaterThan(0)
    })
  }
})
