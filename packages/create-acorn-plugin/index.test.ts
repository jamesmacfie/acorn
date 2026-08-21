import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'
import { parsePluginManifest } from '@acorn/node-core/main/pluginManifest.ts'
// @ts-expect-error: the scaffold is published standalone with zero dependencies, so it's plain
// JavaScript with no declarations. This suite is the only thing in the repository that imports it.
import { API_VERSION, scaffoldFiles, toPluginId } from './index.mjs'

// The scaffold is a copy of the authoring contract living outside the repository's reach: nothing
// a reader of packages/protocol would think to grep finds it, and a stranger's first plugin is
// what breaks when it drifts. See docs/plugin-authoring.md § Start from the scaffold. These are
// the three ways it can drift silently.

it('writes the api major this node actually demands', () => {
  // The one number a manifest must match by exact string comparison. A `failed` roster row on every
  // scaffolded plugin is the failure mode this prevents.
  expect(API_VERSION).toBe(PLUGIN_API_MAJOR)
})

it('emits a manifest the host parses, cross-field rules and all', () => {
  const files = scaffoldFiles('my-widget') as Record<string, string>
  // The host's own parser, not the shape schema: the cross-field rules are what a scaffold trips,
  // such as an openPane naming a pane that isn't declared, or a route outside the plugin's namespace.
  const result = parsePluginManifest(JSON.parse(files['acorn-plugin.json']))
  expect(result.ok ? null : result.reason).toBe(null)
})

it('emits a node half that loads and satisfies the structural plugin check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-'))
  try {
    const files = scaffoldFiles('my-widget') as Record<string, string>
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }

    // What the loader does: import the entrypoint and check the default export structurally. This also
    // proves the relative specifier between the two node files resolves with no node_modules in sight.
    const plugin = (await import(pathToFileURL(join(dir, 'node/index.js')).href)) as {
      default: { name: string; init: unknown }
    }
    expect(plugin.default.name).toBe('my-widget')
    expect(typeof plugin.default.init).toBe('function')

    // The client half can't be imported here: it reaches for `document` at module scope. Parse it
    // instead, since a syntax error in the generated bridge is otherwise a blank rectangle in
    // someone else's app.
    writeFileSync(join(dir, 'client.mjs'), files['client.js'])
    execFileSync(process.execPath, ['--check', join(dir, 'client.mjs')])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('refuses a name with no usable id in it', () => {
  expect(toPluginId('My Widget')).toBe('my-widget')
  expect(toPluginId('acorn.widget')).toBe('acorn-widget')
  // Leading digit, and nothing at all: both are ids the loader would reject, so the CLI says so
  // instead of writing a directory that can never install.
  expect(toPluginId('2fast')).toBe(null)
  expect(toPluginId('!!!')).toBe(null)
})
