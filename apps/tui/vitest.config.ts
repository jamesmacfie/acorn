import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config'

// The `tui` project (docs/testing.md § Test layers). It runs the same transform the bundle does, so a
// test renders through our own tree module rather than through the DOM one, and it inherits the
// `@acorn/plugin-api/ui` alias, so a pane under test imports the kit exactly as the bundle does.
//
// Nothing here passes a flag and nothing here skips. The painter is TypeScript, Yoga through wasm and
// cells in an array, so every drawing test runs on the 24.11.0 the repo pins
// (../../node-runtime.json, docs/future/terminal-rewrite/README.md § Done when).

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
  },
}))
