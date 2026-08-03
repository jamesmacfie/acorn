import type { RuntimeBindings } from '@acorn/node-core/main/bindings.ts'
import { pruneOrphanedGithubMirror } from '@acorn/plugin-github/server/mirrorRetention.ts'

// Security-sensitive startup reconciliation, run pre-listener so an expired payload cannot win a race
// with its first request after boot.
//
// ONE call left. The HTTP plaintext migration moved into plugins/http's init when that plugin took
// ownership of its own tables — NodePlugin.init is awaited before the listener binds, which is the same
// guarantee this module provided. What remains is github's mirror prune, and it goes the same way when
// github converts; the file is then deleted rather than kept as an empty hook.
export async function prepareSecurityState(runtime: RuntimeBindings): Promise<void> {
  await pruneOrphanedGithubMirror(runtime.DB)
}
