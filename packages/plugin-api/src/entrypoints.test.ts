import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Does the facade LOAD? Every other check on this package reads its source — surface.test.ts
// snapshots the export names, tools/arch/boundaries.test.ts greps the specifiers — and the property
// that actually breaks people is neither of those. It is: a plugin's node-environment test suite
// imports @acorn/plugin-api/client, the barrel evaluates every module on it, one of them is a Solid
// component, and the suite dies on `window is not defined` in someone else's package.
//
// So this file loads them, under exactly the conditions the property protects: vitest,
// `environment: 'node'`, no jsdom, no Solid transform — the vitest.config.ts beside this file is the
// same shape every plugin uses. That is why the check lives here as an in-process import rather than
// as a spawned Node child (the shape apps/node/test/integration/mainBarrelLoad.test.ts needs): the
// hazard is what a vitest worker can load, so a vitest worker is the honest place to ask.
//
// It doubles as enforcement of `"sideEffects": false` in package.json. A barrel that did real work at
// module scope — opened a database, read a data root, registered into a live registry — would do it
// here, in a test that passes nothing in and asserts only that names came back.
const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
  exports: Record<string, string>
}

// Derived from the exports map, not listed by hand: a new entrypoint is covered the day it is added,
// which is the difference between a property and an allowlist. The three below are excluded because
// they legitimately need a browser realm, and each says so in its own header:
const BROWSER_REALM = new Set([
  './ui', // frame-safe presentation components — .tsx, so Solid-compiled
  './ui/host', // registration and connected shell surfaces — also .tsx
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
    expect(nodeSafe.sort()).toEqual(['./client', './node', './testkit', './ui/diff', './ui/sdk'])
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
