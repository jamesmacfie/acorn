import { readFileSync, writeFileSync } from 'node:fs'

// Golden lists for the compiled-plugin composition: docs/plugins.md § The golden lists covers the
// mechanism, the regeneration command, and why the comparison is exact equality.
//
// JSON rather than the line-oriented .txt the facade snapshot uses, because these lists are nested
// and order-sensitive. `JSON.parse` round-trips that with no parser of ours to get wrong.
//
// The caller passes a full path, because the snapshots sit beside the suites that read them and this
// helper no longer shares their directory. apps/desktop/test/client/golden.ts is the same idea with
// one directory to worry about; two apps must not import each other's test helpers, and a shared
// package would cost more than the duplication does.

/** Regenerate the golden, but only when explicitly asked. Call before {@link readGolden}. */
export const writeGolden = (path: string, value: unknown): void => {
  if (process.env.UPDATE_PLUGIN_GOLDENS) writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export const readGolden = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
