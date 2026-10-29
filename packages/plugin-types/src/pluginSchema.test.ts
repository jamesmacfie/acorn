import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/plugin/apiVersion.ts'
import { pluginManifestShape } from '@acorn/protocol/plugin/contract.ts'

// The JSON Schema for `acorn-plugin.json`, generated from the Zod contract in
// `packages/protocol/src/plugin/contract.ts` and committed beside this package's declarations, with this
// test as the sync check. It ships in the published package, so an author who installs the types gets
// the schema too, and with it editor completion and inline errors on every contribution array instead of
// a failed boot. Regenerate with `UPDATE_PLUGIN_SCHEMA=1 pnpm test`. The contract stays the one source
// of truth: this test rewrites the file from it and fails if the committed bytes differ.
//
// `io: 'input'` is the right direction: the file an author writes is the schema's input, before
// defaults are applied, so `contributions` and every array in it are optional here and required in the
// parsed type. `unrepresentable: 'any'` because the cross-field refinements (route confinement, pane
// reachability) have no JSON Schema form. The schema is an editing aid; the node's parse is the gate.
const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(HERE, '..', 'acorn-plugin.schema.json')

// The published location. Nothing serves it until the site in apps/site launches, but the file a
// scaffold copies already points where its updates will live.
const SCHEMA_URL = 'https://getacorn.dev/schemas/acorn-plugin.schema.json'

const generate = (): string =>
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: SCHEMA_URL,
      title: `acorn plugin manifest (plugin API major ${PLUGIN_API_MAJOR})`,
      ...z.toJSONSchema(pluginManifestShape, { io: 'input', unrepresentable: 'any' }),
    },
    null,
    2,
  ) + '\n'

it('the committed manifest schema matches the contract it is generated from', () => {
  const generated = generate()
  if (process.env.UPDATE_PLUGIN_SCHEMA) writeFileSync(SCHEMA_PATH, generated)
  // Anti-vacuity: a generator that silently produced `{}` would match an empty file forever.
  const parsed = JSON.parse(generated) as { properties?: Record<string, unknown> }
  expect(Object.keys(parsed.properties ?? {})).toContain('contributions')
  expect(Object.keys(parsed.properties ?? {})).toContain('permissions')
  expect(readFileSync(SCHEMA_PATH, 'utf8')).toBe(generated)
})

// Each description is the hover help in an author's editor and a row on the site's plugin reference,
// so a field can't land without one. Nested properties count, including those inside unions and arrays.
it('describes every property in the manifest schema', () => {
  const undescribed = new Set<string>()
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, path))
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'properties') walk(value, path)
      else
        for (const [name, property] of Object.entries(value as Record<string, { description?: string }>)) {
          if (!property.description) undescribed.add(`${path}.${name}`)
          walk(property, `${path}.${name}`)
        }
    }
  }
  walk(JSON.parse(generate()), '')
  expect([...undescribed]).toEqual([])
})
