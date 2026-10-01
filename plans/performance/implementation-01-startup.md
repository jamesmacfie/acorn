# Startup implementation

Unit 01 implements the two measured handoffs in [the startup audit](./01-startup.md). The Node
ownership store skips exact repeats. Custody commits the bundled cache index and trust decisions
once per changed store. Package hashing, atomic fsynced metadata, and the bundled trust opt-out
remain active.

## Owners and contracts

The Node reconciles read-only application packages into its writable plugin root before discovery.
`bundledState.ts` owns the ownership file, so it compares status, version, fingerprint, and
installation time before writing. Reconciliation still hashes source and target files, repairs a
missing row or installed directory, and preserves owner modifications, user-managed rows,
development markers, and uninstall tombstones. This change stores no additional fingerprint cache.

The helper owns the device's content-addressed client cache and trust file. `PluginCache` reads and
hashes one supplied resource body at a time, places successful bodies, and commits their index rows
together. `PluginTrustStore` validates acknowledgements independently, preserves unchanged decision
timestamps, and commits successful disclosures together. Each store publishes its changed memory
state only after its atomic file write returns successfully.

The cache and trust commits remain separate. Cache commits first. A trust failure leaves reusable
bytes without publishing a new decision. A cache failure stops the acknowledgement pass. The pass
returns no successful acknowledgement list after either metadata commit fails, while previously
stored decisions remain intact. A following launch can retry. A malformed, unreadable, or oversized
individual package does not block valid siblings.

Application-resource acceptance retains its previous handling of a rejected decision about those
exact bytes. It can replace that decision with the application's bundled acceptance. Unrelated
rejections and development grants remain unchanged. Remote bundle claims still require their own
byte hash check, and owner decisions still use the individual store operations. The renderer gains
no filesystem path, trust grant, or storage responsibility. Proposed browser and device-held custody
can implement batching at their own store boundary without changing the consent rule.

## Changed files

| File | Change |
| --- | --- |
| `packages/node-core/src/server/plugins/bundledState.ts` | Compare the exact ownership entry before an atomic write. |
| `packages/node-core/src/server/plugins/bundledState.test.ts` | Verify zero exact-repeat writes and persistence when any installed field or ownership status changes. |
| `packages/node-core/src/server/plugins/bundled.test.ts` | Verify missing-row recovery, missing-directory recovery with the original timestamp, and preservation of modified installed bytes. |
| `packages/custody/src/plugins/pluginCache.ts` | Add lazy synchronous bundled batching, isolate package failures, and publish rows after the durable index commit. |
| `packages/custody/src/plugins/pluginCache.test.ts` | Verify partial success, failed-commit and atomic-replacement retry, and remote provenance during missing-file repair. |
| `packages/custody/src/plugins/pluginTrustStore.ts` | Add independently validated decision batching and publish decisions and grants after the durable commit. |
| `packages/custody/src/plugins/pluginTrustStore.test.ts` | Verify partial disclosure validation, timestamp stability, unrelated rejection and grant retention, and failed-commit and atomic-replacement recovery. |
| `packages/custody/src/plugins/bundledPluginTrust.ts` | Orchestrate one cache batch followed by one trust batch over validated application resources. |
| `packages/custody/src/plugins/bundledPluginTrust.test.ts` | Verify seven-package commit bounds, unchanged and provenance-only passes, private file modes, malformed siblings, rejection handling, and both commit failures. |
| `docs/node-distribution.md` | Document exact ownership write suppression and recovery. |
| `docs/security.md` | Document ordered custody batching, partial failures, durable writes, and retry semantics. |
| `plans/performance/bench-startup-unit01.mjs` | Alternate the preserved startup workloads against untouched baseline source and the implementation. |

## Regression verification

The added ownership repeat test failed before the source change: one atomic write occurred when
zero was expected. The added seven-package bundled test also failed before the source change:
fourteen atomic metadata commits occurred when two were expected. The other five ownership-field
cases and five original bundled-client tests passed in that before run.

Focused verification passed:

| Command | Result |
| --- | --- |
| `rtk proxy pnpm --filter @acorn/node-core exec vitest run src/server/plugins/bundledState.test.ts src/server/plugins/bundled.test.ts` | Two files, 16 tests passed. |
| `rtk proxy pnpm --filter @acorn/custody exec vitest run src/plugins/bundledPluginTrust.test.ts src/plugins/pluginCache.test.ts src/plugins/pluginTrustStore.test.ts` | Three files, 46 tests passed. |
| `rtk proxy pnpm --filter @acorn/node-core lint` | Typecheck passed. |
| `rtk proxy pnpm --filter @acorn/custody lint` | Typecheck passed. |
| `rtk proxy pnpm exec oxlint` with the nine changed source and test files | Passed with no warnings. |
| `rtk proxy pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts` | One file, three tests passed. |
| `rtk proxy git diff --check` | Passed. |

The first custody typecheck identified a missing public manifest type export. The implementation
uses the actual manifest reader's return type without extending the package's public surface. The
subsequent typecheck passed. A broader plugin-directory oxlint run reported an unrelated preexisting
spread warning in `pluginRpc.test.ts`; changed files pass their targeted check.

The atomic-replacement tests execute the real open, write, fsync, and close operations, then inject a
rename failure. Both files retain their prior durable contents, both store instances retain their
prior rows, and retry commits the successor. The cache test lets the body placement finish before
failing the index replacement. The trust test preserves a prior rejection until replacement succeeds.

## Measurements

The [interleaved evidence](./evidence/startup-unit01-interleaved.json) runs the original probe scripts
against original source and the implementation. Both use Node 24.11.0 and the same absolute,
unchanged staged bundled-plugin directory. Five rounds alternate before-first and after-first order.
Each variant runs five fresh processes per workload. Reconciliation seeds eight packages before ten
unchanged passes per process. Client trust accepts seven clients in every pass. Fixture creation,
imports, and cleanup remain outside the timed public operations.

| Workload | Samples per variant | Median before | Median after | Fsyncs per pass before / after | Low-level writes before / after |
| --- | --- | --- | --- | --- | --- |
| Unchanged Node reconciliation | 50 across five processes | 49.665 ms | 11.425 ms | 8 / 0 | 8 / 0 |
| Cold seven-client custody | 5 | 96.91 ms | 36.19 ms | 14 / 2 | 21 / 9 |
| App-version-only provenance | 5 | 37.73 ms | 8.15 ms | 7 / 1 | 7 / 1 |
| Unchanged client custody | 15 across five processes | 4.24 ms | 3.26 ms | 0 / 0 | 0 / 0 |

The first three workloads remove 38.24 ms, 60.72 ms, and 29.58 ms from their measured median slices.
Reconciliation still performs 102 reads totaling 7,666,257 bytes per pass, with zero installs,
updates, or failures. Trust still performs 15 reads totaling 774,480 bytes and accepts seven clients
per pass. Unchanged client custody stays write-free. These equal read counts and results confirm
that the measured saving comes from omitted durable writes while source validation continues.

The coordinator created original source with `git archive f8e4b59c` at
`/tmp/acorn-perf-original-f8e4b59c`. Offline frozen installation lacked the cached `drizzle-kit`
tarball. The coordinator copied the 35 package dependency layouts, retained all 165 `@acorn`
workspace links inside the archive, and shared installed external dependencies through the checkout's
pnpm store. Original and changed workspace source therefore remain separate, while dependency
versions and staged workload bytes match. The coordinator verified both original public owners
import before the alternating run.

Run the paired measurement with:

```sh
rtk proxy node plans/performance/bench-startup-unit01.mjs /tmp/acorn-perf-original-f8e4b59c plans/performance/evidence/startup-unit01-interleaved.json
```

The runner refuses to overwrite its output. Use a distinct filename for a repeat. The first after
round is also extracted without modification into
[ownership after evidence](./evidence/startup-reconcile-after.json) and
[trust after evidence](./evidence/startup-trust-after.json). The original
[ownership before evidence](./evidence/startup-reconcile-before.json) and
[trust before evidence](./evidence/startup-trust-before.json) remain unchanged. The coordinator's
[independent after replay](./evidence/startup-reconcile-coordinator-after.json) confirms zero writes,
fsyncs, and failures across ten unchanged passes, with median 12.135 ms.

## Remaining gates

The coordinator owns cumulative `pnpm lint`, bounded `pnpm test`, desktop staging and tests, and
fresh isolated native launches. No renderer, helper, service, bundled package, or Rust artifact was
rebuilt for this unit. The coordinator stopped the baseline app before replacement staging. The
source benchmarks measure removed startup work and durable operation counts. They do not establish
a visible paint saving or an all-day memory improvement.
