import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Does the facade load in a plugin's own test environment? See docs/plugins.md § The plugin API for
// the barrel/tier boundary this protects: a `.tsx` module anywhere behind an entrypoint dies on
// `window is not defined` in someone else's package the moment that plugin's suite imports it.
//
// This file loads every entrypoint in process, under vitest's node environment with no jsdom and no
// Solid transform, rather than spawning a child the way
// apps/node/test/integration/mainBarrelLoad.test.ts does. The hazard is what a vitest worker can
// load, so a vitest worker is the honest place to ask. It doubles as enforcement of
// "sideEffects": false, since a barrel doing real work at module scope would do it here too.
const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
  exports: Record<string, string>
}

// Derived from the exports map, not listed by hand: a new entrypoint is covered the day it is added,
// which is the difference between a property and an allowlist. The three below are excluded because
// they legitimately need a browser realm, and each says so in its own header:
const BROWSER_REALM = new Set([
  './ui', // frame-safe presentation components, .tsx, so Solid-compiled
  './ui/host', // registration and connected shell surfaces, also .tsx
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
    //
    // `./ui/tokens` is the kit's vocabulary as data — role enums and the support matrix, no
    // components — and being loadable here is exactly why it is its own entrypoint.
    // `./ui/tree` is node-safe: it is the sandbox's own renderer, so it reaches Solid's isomorphic
    // core and the remote root and nothing that touches a document.
    //
    // `./ui/editor` used to sit in BROWSER_REALM below: it re-exports the editor theme, and Monaco read
    // `window` at module scope, so importing it here threw. CodeMirror does not, so the entrypoint is
    // node-safe now and a plugin test that wants an editor theme can have one. It stays a separate
    // entrypoint for the other reason its header gives — keeping the grammars out of every pane's boot
    // graph — which is a bundling concern, not a realm one.
    expect(nodeSafe.sort()).toEqual(['./client', './node', './testkit', './testkit/client', './ui/diff', './ui/editor', './ui/sdk', './ui/tokens', './ui/tree'])
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
