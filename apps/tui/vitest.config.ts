import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config'

// The `tui` project (docs/testing.md § Test layers). It runs the same transform the bundle does, so a
// test renders through OpenTUI's reconciler rather than through the DOM one, and it inherits the
// `@acorn/plugin-api/ui` alias, so a pane under test imports the kit exactly as the bundle does.
//
// OpenTUI's render core is Zig reached over `node:ffi`, a Node 26.4 builtin behind a flag. The flag is
// passed here rather than in a script somebody has to remember — and only where it is accepted, because
// an older Node treats an unknown flag as fatal and would fail the repo's suite for a reason that has
// nothing to do with the change under test. The test itself skips when there is no FFI to draw with.
//
// Under `ACORN_TUI_PAINTER=own` the flag is not passed at all, and that is the demonstration rather
// than a tidy-up: the alias `vite.config.ts` swaps points every JSX call at a painter that is
// TypeScript, Yoga through wasm and cells in an array, so the drawing tests run on the 24.11.0 the
// repo pins (../../node-runtime.json, docs/future/terminal-rewrite/README.md § Done when). `canDraw`
// in `src/ffi.ts` is the gate the suites ask, and it says yes on any Node under that switch.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
const hasFfiFlag = process.env.ACORN_TUI_PAINTER !== 'own' && (major > 26 || (major === 26 && minor >= 4))

export default mergeConfig(base, defineConfig({
  // `ws` ships a `browser` export condition whose whole body is a throw, and this pipeline picks it:
  // the broker's `new WebSocket(...)` then fails with "not a constructor" after the HTTP half of the
  // same connection worked, which is a confusing hour. Resolved here rather than in vite.config.ts,
  // because the bundle leaves `ws` external and a deep specifier would not resolve there — `ws`
  // exports its root and nothing else.
  resolve: { alias: [{ find: /^ws$/, replacement: fileURLToPath(import.meta.resolve('ws')) }] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    ...(hasFfiFlag ? { execArgv: ['--experimental-ffi'] } : {}),
  },
}))
