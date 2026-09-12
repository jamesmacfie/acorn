import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { ENROLLMENT_PROTOCOL_VERSION, enrollmentRequestSchema } from '@acorn/protocol/enrollment.ts'

// The published JSON schema for the enrollment payload, pinned against the Zod schema the node
// actually posts (docs/node-enrollment.md).
//
// This is the Headscale lesson made mechanical. The moment a third party can write a control plane the
// protocol is a public interface whether or not anyone versioned it, so the document has to be right,
// and a document nothing checks is a document that drifts. Regenerate with
// `UPDATE_ENROLLMENT_SCHEMA=1`.
//
// It lives in node-core rather than beside the schema because packages/protocol may import nothing but
// zod (tools/arch/boundaries.test.ts), and a drift check has to read a file.

const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

const PUBLISHED = join(ROOT, `docs/schemas/enrollment-v${ENROLLMENT_PROTOCOL_VERSION}.json`)

it('the published enrollment schema matches what the node posts', () => {
  const generated = `${JSON.stringify(z.toJSONSchema(enrollmentRequestSchema, { target: 'draft-2020-12' }), null, 2)}\n`
  if (process.env.UPDATE_ENROLLMENT_SCHEMA) writeFileSync(PUBLISHED, generated)
  // A version bump wants a new file, not an edited one: a control plane built against v1 must be able
  // to keep reading v1 (docs/node-enrollment.md § Versioning).
  expect(existsSync(PUBLISHED)).toBe(true)
  expect(readFileSync(PUBLISHED, 'utf8')).toBe(generated)
})
