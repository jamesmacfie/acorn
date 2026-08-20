import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Golden lists for the compiled-plugin composition, kept the way packages/plugin-api/src/surface.test.ts
// keeps the facade's export surface: the expected value is a committed file next to the test, not a
// literal inside it. Adding a pane, rail source, route or registry entry used to fail a test whose fix
// was "find the table, hand-add a row". Now the fix is one command:
//
//   UPDATE_PLUGIN_GOLDENS=1 pnpm --filter @acorn/desktop --filter @acorn/node test
//
// and the review surface is the snapshot diff. Regenerate in its own hunk, with a sentence about why the
// list moved: the diff is the only place a reviewer sees what a plugin now claims.
//
// The assertions stay exact equality against the file, never a subset. A list that can only grow hides a
// contribution that silently vanished.
//
// JSON rather than the line-oriented .txt the facade snapshot uses, because these lists are nested and
// order-sensitive: registration order is part of what must survive a sibling's disable. Every row is a
// flat string, because a tuple would pretty-print over five lines and make the diff unreadable.
//
// Ceiling: these fifteen lines exist twice, once per app (see apps/node/test/integration/golden.ts). Two
// apps must not import each other's test helpers, and a shared package would cost more than the
// duplication does.

const HERE = dirname(fileURLToPath(import.meta.url))

/** Regenerate the golden, but only when explicitly asked. Call before {@link readGolden}. */
export const writeGolden = (name: string, value: unknown): void => {
  if (process.env.UPDATE_PLUGIN_GOLDENS) writeFileSync(join(HERE, name), `${JSON.stringify(value, null, 2)}\n`)
}

export const readGolden = <T>(name: string): T => JSON.parse(readFileSync(join(HERE, name), 'utf8')) as T
