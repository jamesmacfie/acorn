import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { PLUGIN_CONFIG_FILE, validatePluginConfig } from '@acorn/node-core/testkit'
import { PUBLIC_EXTENSION_POINTS } from '@acorn/protocol/publicExtensionPoints.ts'

// Checked against the real manifest schema at `pnpm test` time, for every loadable plugin
// (docs/plugins/dev-loop.md § The dev loop: "A malformed acorn-plugin.config.mjs no longer waits for a
// rebuild or a boot to announce itself").
//
// The rules it catches are the ones no reviewer checks by eye: a route or rail-items path outside
// the plugin's own `/v1/p/<id>/` prefix, an `openPane` naming a frame the manifest never declared, a
// duplicate contribution id, a brand mark that is not a bare path `d`.
//
// This lives in apps/node because apps/node owns the builder that reads these files. It walks the
// filesystem rather than listing ids, so a plugin that becomes loadable tomorrow is covered the day
// its config lands.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const PLUGINS = join(ROOT, 'plugins')

const configs = readdirSync(PLUGINS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(PLUGINS, entry.name, PLUGIN_CONFIG_FILE)))
  .map((entry) => entry.name)

describe('loadable plugin configs', () => {
  it('finds the loadable plugins (anti-vacuity)', () => {
    // Five as of writing: database, http, linear, model-providers, rollbar. The assertion is a floor, so
    // adding one is ordinary work and losing them all is a failure.
    expect(configs.length).toBeGreaterThanOrEqual(4)
  })

  it.each(configs)('%s declares a manifest the loader would accept', async (id) => {
    const result = await validatePluginConfig(join(PLUGINS, id))
    // The reason, not `false`: the whole value of the validator is the sentence it produces.
    expect(result.ok ? 'ok' : result.reason).toBe('ok')
  })
})

// The manifest half of the `plugin_authoring` point list (packages/protocol/src/chrome/publicExtensionPoints.ts).
// The client registry test covers points registered in code; these are declared in a config instead.
it('lists every remote or annotation point a loadable plugin declares in the authoring catalogue', async () => {
  const declared: { id: string; kind: string; mode?: string; max?: number }[] = []
  for (const id of configs) {
    const config = (await import(pathToFileURL(join(PLUGINS, id, PLUGIN_CONFIG_FILE)).href)).default as {
      contributions?: { extensionPoints?: { id: string; kind?: string; mode?: string; max?: number }[] }
    }
    for (const point of config.contributions?.extensionPoints ?? []) {
      if (point.kind === 'remote' || point.kind === 'annotation') declared.push({ id: `${id}:${point.id}`, kind: point.kind, mode: point.mode, max: point.max })
    }
  }
  expect(declared.length).toBeGreaterThan(1)
  for (const point of declared) {
    const listed = PUBLIC_EXTENSION_POINTS.find((entry) => entry.id === point.id)
    expect(listed && { kind: listed.kind, mode: 'mode' in listed ? listed.mode : undefined, max: listed.max }, point.id)
      .toEqual({ kind: point.kind, mode: point.mode, max: point.max })
  }
})
