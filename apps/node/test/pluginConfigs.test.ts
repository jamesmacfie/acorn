import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PLUGIN_CONFIG_FILE, validatePluginConfig } from '@acorn/node-core/testkit/manifest.ts'

// Every loadable plugin's declaration, checked against the real manifest schema — here, at `pnpm test`
// time, rather than at the next boot.
//
// Nothing did this. A malformed `acorn-plugin.config.mjs` was found by running the builder, or by a
// boot-time console line in a packaged app that shows it to nobody. The rules it catches are the ones no
// reviewer checks by eye: a route or rail-items path outside the plugin's own `/v2/p/<id>/` prefix, an
// `openPane` naming a frame the manifest never declared, a duplicate contribution id, a brand mark that
// is not a bare path `d`.
//
// This lives in apps/node because apps/node owns the builder that reads these files. It walks the
// filesystem rather than listing ids, so a plugin that becomes loadable tomorrow is covered the day its
// config lands.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
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
