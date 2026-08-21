import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Golden lists for the compiled-plugin composition: docs/plugins.md § The golden lists covers the
// mechanism, the regeneration command, and why the comparison is exact equality.
//
// JSON rather than the line-oriented .txt the facade snapshot uses, because these lists are nested
// and order-sensitive. `JSON.parse` round-trips that with no parser of ours to get wrong.
//
// These fifteen lines exist twice, once per app (see apps/desktop/test/client/golden.ts). Two apps
// must not import each other's test helpers, and a shared package would cost more than the
// duplication does.

const HERE = dirname(fileURLToPath(import.meta.url))

/** Regenerate the golden, but only when explicitly asked. Call before {@link readGolden}. */
export const writeGolden = (name: string, value: unknown): void => {
  if (process.env.UPDATE_PLUGIN_GOLDENS) writeFileSync(join(HERE, name), `${JSON.stringify(value, null, 2)}\n`)
}

export const readGolden = <T>(name: string): T => JSON.parse(readFileSync(join(HERE, name), 'utf8')) as T
