# PR markers implementation record

Date: October 2, 2026. Unit 15. The future handoff is deleted. Other agents implement
units 13, 14, and 17 in this checkout; their changes remain outside this commit.

## Ownership and compatibility

GitHub owns scoped mirror comparison facts and an active-wave map inside each provider instance.
Each request resolves its authorized task root, captured active user, and mirrored repository/pull
before joining. The key includes root, user, mirror repository ID, pull number, base ref, and exact
PR head SHA. Only common head/base resolution and merge-base work join. Completed and rejected waves
leave no idle cache. Every file independently diffs the immutable mirrored PR head and translates
through later commits and disk edits. A local-only insertion never acquires PR provenance.

Base branch validation, remote/local/raw fallback order, exact head SHA checks, and 10/15-second
command deadlines remain. Diffs use literal paths and disable external diff and text conversion.
Failed or truncated diffs do not publish fabricated clean or untranslated sets. Missing PR refs
remain an optional absent contribution. Changes retains unborn, untracked, staged, and unstaged
semantics, verifies the optional supplied root, and rejects failed or truncated file diffs.

The editor Node owns confined body observation in `markerSnapshot.ts`. Its additive `revision`
query parameter requests `{ revision, markers }` instead of the legacy array. The requested SHA-256
names the exact displayed UTF-8 text. The Node observes file bytes and device/inode/size/mtime/ctime
around each read and on both sides of provider work, and re-resolves confinement. Only a matching
body and source identity receive a revision. Missing or changed bodies receive a null revision.
Providers return provenance; an optional third argument identifies the confined root without
granting filesystem authority. Legacy loaded providers can ignore it. Optional provider failures
remain isolated by the editor's aggregation owner.

The captured-Node HTTP client rejects legacy arrays and mismatched revisions. Older clients keep
the array route, and an older capability without `markerSnapshot` returns an unverifiable result.
No core broker or protocol envelope change is required: the plugin's declared task route and
capability carry the additive query and response through the ordinary Node transport. Both
standalone and loaded editor clients use that route.

`EditorPane.tsx` hashes the captured clean custody document, then checks returned body identity,
Node, entry, request generation, and edit revision before publishing. Initial body reads can open
before marker work. Dirty or saving text does not admit disk annotations. Stale replies preserve
correct markers for the displayed text; save completion, focus, clean undo, and cached-tab return
can retry. The CodeMirror marker field clears on every document change, including formatter and
reload replacements. This integrates unit 16's custody owner without replacing its save lifecycle.
Generic host documents and the terminal client's external editor do not consume disk markers.

Changed owners: GitHub comparison/mirror reader; Changes marker provider; editor contracts,
route capability, snapshot aggregation, captured API, pane, and decoration field. Tests sit beside
these owners. Shipped contracts are documented in `docs/editor.md` and `docs/github-integration.md`;
the performance index links this record and marks unit 16's identity integration complete.

## Matched evidence

Fresh cumulative baseline: `11-markers-unit15-before.json`, with marker owner and probe hashes in
`unit15-before-hashes.json`. Accepted source hashes: `unit15-after-hashes.json`. The historical
probe remains unchanged by this unit. Unit 14 independently adjusts other cases in that probe;
the `markers` workload is the same eight disposable files, actual provider, and actual Git owner.
`11-markers-unit15-after.json` preserves the intermediate replay; the accepted replay is
`11-markers-unit15-accepted.json`.

| Eight concurrent file reads | Before | Accepted |
| --- | --- | --- |
| Common commands | 32 | 4 |
| File diffs | 16 | 16 |
| Total commands | 48 | 20 |
| Peak Git children | 16 | 16 |
| Each returned range | Line 2 | Line 2 |
| Subsequent single-file commands | 6 | 6 |
| Node process CPU | 86.760 ms | 56.501 ms |
| Wall time | 97.728 ms | 271.277 ms |

This removes 28 commands, or 58.3% of total commands. It does not establish native latency or child
Git CPU gains. The Node CPU excludes child CPU. Wall time increased in the shared checkout while
other agents and verification ran; the intermediate replay also increased to 380.685 ms. These
artifacts establish removed work and exact ranges, without a latency claim.

Body verification adds one complete client text encoding/hash and two complete confined disk reads
and hashes for an admitted marker request. A mismatched initial body skips providers. Neither
dirty content nor undo state is evicted, and no completed comparison promises remain cached.

## Verification

Commands use the repository-required `rtk proxy` prefix.

- `node --expose-gc --import tsx plans/performance/11-git-probe.mjs markers unit15-before`
  and `markers unit15-accepted`: actual Git workload, eight exact ranges, 48 versus 20 commands;
  each disposable repository is removed in the probe's finalizer.
- `pnpm --filter @acorn/plugin-editor test`: 15 files, 103 tests pass. A final focused replay of
  `src/client/EditorPane.test.tsx` passes 28 tests, including the added exact BOM/Unicode/CRLF case.
- `pnpm --filter @acorn/plugin-github test`: 40 files, 230 tests pass. The final provider replay
  passes seven tests, including exact SHA mismatch rejection, ref freshness, mirror/root/user
  separation, rejected-wave recovery, literal filenames, local translation, and disabled drivers.
- `pnpm --filter @acorn/plugin-changes exec vitest run src/server/editorLineMarkers.test.ts`:
  two tests cover actual Git semantics and failed/truncated output.
- Real-filesystem editor route tests cover optional/legacy providers, confinement, exact UTF-8,
  same-size restored-mtime edits, write-and-restore, root changes, and a fresh retry.
- Real CodeMirror tests use the normal QueryClientProvider and the repository's shared browser
  Solid configuration. They hold replies across edit, save, reload, Node switch, disposal, and
  cached-tab return. These are jsdom behavior checks, not native timing.
- `pnpm lint`: the final attempt completes 30 tasks before failing in the concurrently edited
  `plugins/agents/src/server/sessions/sessionExecute.test.ts` on event callback types and unknown
  nested events. Earlier attempts caught fixture type errors corrected in this unit and a
  concurrently edited unit 14 test; those failures were not accepted as passes.
- `pnpm --filter @acorn/plugin-editor lint`, `pnpm --filter @acorn/plugin-github lint`, and
  `pnpm --filter @acorn/plugin-changes lint`: all three changed plugins pass TypeScript checks.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts entrypoints.test.ts`:
  two files, 59 architecture and documentation-path checks pass.
- `pnpm dev:agent -- --session unit15-markers`: staging fails before a native window opens.
  The Node service is 3,091,505 bytes against a 3,062,000-byte ceiling. The explicit
  `pnpm dev:agent:ui -- --session unit15-markers stop` confirms the session is not running.

## Limits

Before/after observations do not lock external writers. A filesystem that lets mutations evade
both byte comparisons and inode/change-time observations can still defeat this check. A write
after the final observation leaves markers describing the displayed captured body until a reload;
it cannot authorize markers for a different displayed body. Legacy providers remain responsible
for honoring their working-document range contract. Native graphical verification remains blocked
by the combined branch's service bundle gate. No normal profile, paid provider, branch, or subagent
is used. Sustained-use performance and two-Node native validation remain programme-level work.
