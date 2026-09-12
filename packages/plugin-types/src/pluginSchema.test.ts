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
// the schema too. Regenerate with `UPDATE_PLUGIN_SCHEMA=1 pnpm test`.
//
// docs/future/ecosystem/README.md used to record "a JSON Schema: deliberately not built", on the
// grounds that a second schema is a second source of truth. That refusal was against a hand-maintained
// copy and it was right about one. Generated, there is still one source of truth: the file below cannot
// say anything `pluginContract.ts` does not, because this test rewrites it from the contract and fails
// if the committed bytes differ.
//
// What it buys is the thing prose cannot: an author editing a manifest gets completion and inline
// errors on every contribution array from their editor, instead of finding out at the next boot.
//
// `io: 'input'` is the right direction: the file an author writes is the schema's input, before
// defaults are applied, so `contributions` and every array in it are optional here and required in the
// parsed type. `unrepresentable: 'any'` because the cross-field refinements (route confinement, pane
// reachability) have no JSON Schema form. The schema is an editing aid; the node's parse is the gate.
const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(HERE, '..', 'acorn-plugin.schema.json')

// The published location, once apps/site exists (docs/future/marketing/README.md phase 3). Written into
// the artifact now so the file a scaffold copies already points at where its updates will live.
const SCHEMA_URL = 'https://acorn.sh/schemas/acorn-plugin.schema.json'

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
