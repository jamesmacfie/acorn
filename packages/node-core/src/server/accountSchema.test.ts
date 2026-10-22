import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { ACCOUNT_API_VERSION, accountMessages } from '@acorn/protocol/account.ts'

// The published JSON schemas for the account API, pinned against the Zod schemas the sign-in plugin,
// the relay, and the stand-in parse with (docs/account-api.md). One file holds every message, under
// `$defs`, because the API's version and its schemas move together. Regenerate with
// `UPDATE_ACCOUNT_SCHEMA=1`. It lives in node-core for the reason the enrollment pin does: protocol
// may import only zod, and a drift check has to read a file.

const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

const PUBLISHED = join(ROOT, `docs/schemas/account-v${ACCOUNT_API_VERSION}.json`)

it('the published account schema matches what the account API parses', () => {
  const defs = Object.fromEntries(
    Object.entries(accountMessages).map(([name, schema]) => {
      const { $schema: _draft, ...definition } = z.toJSONSchema(schema, { target: 'draft-2020-12' })
      return [name, definition]
    }),
  )
  const generated = `${JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: defs }, null, 2)}\n`
  if (process.env.UPDATE_ACCOUNT_SCHEMA) writeFileSync(PUBLISHED, generated)
  // A version bump wants a new file, not an edited one, so a service built against v1 keeps reading v1.
  expect(existsSync(PUBLISHED)).toBe(true)
  expect(readFileSync(PUBLISHED, 'utf8')).toBe(generated)
})
