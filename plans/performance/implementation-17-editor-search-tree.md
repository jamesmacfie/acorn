# Editor search, tree viewport, and graphical admission

Implemented October 2, 2026. Unit 17. Native and isolated PTY driver acceptance remains blocked
by the cumulative Node service bundle budget. This record replaces the unit handoff.

## Owners and changes

The editor plugin owns task-root authorization, search production, panel requests, directory
listings, and file state admission. The Node resolves the task root for each search. The client
captures QueryClient Node ownership before sending through the transport. The search capability
accepts an optional forwarded Request, whose signal crosses the compiled and isolated worker RPC
paths. No raw signal enters a JSON body, and the client never chooses a filesystem root.

- `plugins/editor/src/server/searchProcess.ts` owns ripgrep, incremental record assembly,
  bounded stderr, timeout, abort, termination escalation, and exit/pipe joining.
- `plugins/editor/src/server/searchResults.ts` retains accepted matches, groups files, preserves
  previews and Unicode columns, and requires an additional supported match before truncating.
- The search route maps machine errors to HTTP responses. The panel owns its controller and
  generation, cancels superseded input and disposal, cancels its debounce, and guards deferred focus.
  Hiding the panel retains valid work.
- FileTree captures Node/task identity, joins same-generation reads, refreshes loaded listings in
  parent order, preserves successful listings on errors, offers retry, and fences reveal chains.
  Worktree events carry no path; refresh conservatively covers every loaded branch, including
  collapsed cached directories, without traversing unopened directories.
- FileTree uses portable virtual Rows and TreeRow placement. Rows keys visible owners by stable
  reconciled items. Separate animation-frame owners prevent an early listing from cancelling
  scroll-element publication. An early or hidden reveal waits for positive geometry.
- EditorPane warms text only for graphical mode on the DOM host. The actual Rectangle mount
  admits the dynamic engine import and file state construction. Surface retirement fences pending
  admission. The TUI keeps the real text custody owner through an explicit package leaf export,
  and accepts TreeRow placement without interpreting DOM pixels.

The 64 MiB single-record ceiling exceeds the former 32 MiB whole-output ceiling. This preserves
previously supported minified-line matches and exact columns without max-columns. Oversized and
invalid records fail explicitly. Stderr retains at most 64 KiB. At most 2,000 hits and one partial
record are retained. Temporary record concatenation, UTF-8 decoding, and JSON parsing can hold
several representations of that one bounded record; this is not a 64 MiB total-heap promise.
No-match exit is successful. Invalid regex, unavailable root, launch failure, timeout, overflow,
invalid output, execution failure, and caller cancellation are distinct. Deliberate truncation joins
its killed child and returns the accepted result rather than treating its own signal as an error.

## Evidence

Fresh source hashes are in `unit17-before-hashes.json`. Before results remain in
`12-search-unit17-before.json` and `12-tree-unit17-before.json`. After results are
`unit17-search-after.json`, `unit17-tree-admitted.json`, and `unit17-tui-host-verified.json`.
The browser config pins one Solid runtime, the Solid Query ESM entry, and the virtualizer ESM entry.
The final tree probe uses an ordinary QueryClient provider and verifies a published 300 px viewport.
Earlier after samples measured fallback rows before successful viewport publication and were
superseded during implementation; only the admitted result is accepted as viewport evidence.

| Workload | Cumulative before | After |
| --- | --- | --- |
| 2,000 real matches | 2,000 hits; complete; 786,960 stdout bytes | 2,000 hits; complete; 786,961 stdout bytes |
| 8,000 real matches | 2,000 hits; truncated; 3,154,156 stdout bytes | 2,000 hits; truncated; 983,040 stdout bytes |
| 100,000 real matches | Buffer overflow; zero hits; falsely complete; 33,554,432 stdout bytes | 2,000 hits; truncated; 917,504 stdout bytes |
| Root with 201 entries | 201 row elements; 805 total elements | 21 row elements; 87 total elements |
| Root with 2,001 entries | 2,001 row elements; 8,005 total elements | 21 row elements; 87 total elements |
| Expansion | First row retained | First row retained with reactive placement |
| TUI remembered 1.5 MB file | Historical investigation reported undrawn state; fresh legacy probe failed and is not a valid paired baseline | One root read; zero file/marker reads, engine imports, pooled states, or saved documents |

The search process monitor counts drained stdout without retaining its contents and verifies every
child PID is absent after close. The 100,000-match Node CPU sample changes from 66.153 ms to
8.989 ms; the post-GC heap delta changes from 27,378,312 bytes to 39,288 bytes. These are single
synthetic samples, exclude ripgrep CPU, and do not establish native latency or a sustained plateau.
The tree probe measures jsdom. The cold 201-entry after sample costs 108.913 ms Node CPU against
80.462 ms before; the 2,001-entry samples are 14.696 ms after and 494.108 ms before. After sampling
waits for viewport publication and includes provider composition. DOM count reduction is the primary
comparable result, and these CPU samples are not presented as desktop speed measurements.

## Verification

Commands use the RTK prefix required by the repository instructions.

- `rtk proxy node --expose-gc --import tsx plans/performance/12-node-probe.mjs search unit17-before`:
  fresh real ripgrep baseline captured.
- `rtk proxy node --expose-gc --import tsx plans/performance/unit17-node-probe.mjs search after`:
  exact hit counts, truthful truncation, bounded drained output, and no remaining PIDs.
- `rtk proxy env ACORN_PERF_TAG=admitted pnpm exec vitest run --config plans/performance/unit17-probe.config.ts`:
  actual FileTree/Rows, 201 and 2,001 entries, 300 px viewport, bounded DOM, and retained identity.
- `rtk proxy pnpm exec vitest run --config plans/performance/unit17-transport-probe.config.ts`:
  real isolated worker, forwarded route Request, held actual ripgrep child, caller cancellation,
  and joined child exit. The fixture holds only its own child with SIGSTOP and cleans it up.
- `rtk proxy env ACORN_PERF_TAG=host-verified pnpm exec vitest run --config plans/performance/unit17-tui-probe.config.mts plans/performance/unit17-tui-probe.test.tsx`:
  two tests pass. Actual universal TUI composition admits zero graphical states; the real terminal
  editor Rectangle opens its synthetic channel, draws output, and closes it on disposal.
- `rtk proxy pnpm --filter @acorn/plugin-editor test`: 91 tests pass. Includes real Unicode/minified
  lines, 2,000/8,000/100,000 matches, invalid regex, no match, rejected root, missing executable,
  timeout, pre-abort, malformed/oversized output, SIGTERM-resistant child retirement, stale listings,
  retained success/retry, superseded reveal, panel replacement, hiding, and debounce disposal.
- `rtk proxy pnpm --filter @acorn/client-core exec vitest run src/kit/keys/collection.test.tsx src/kit/components/layout/Rows.test.tsx`:
  nine tests pass. The Rows regression also covers an asynchronous initial listing, zero geometry,
  later resize, far reveal, active descendant, density, and identity after insertion.
- `rtk proxy pnpm --filter @acorn/tui exec vitest run src/invariants.test.ts src/kit/scrolling.test.tsx`:
  16 tests pass, including the cell viewport and collection projection.

- `rtk proxy pnpm lint`: passes all 37 package tasks, including oxlint and package TypeScript checks.
  Earlier runs exposed concurrent Docker edits, the TUI's missing custody exports from unit 16,
  and a test callback type. The final run includes the compatibility and callback fixes.
- Architecture validation covers documentation links, package boundaries, kit entries, the relocated
  process exception, and the explicit text-custody export. Its final outcome is recorded below.

The installed runtime is Node 24.11.0 and pnpm 11.0.0. Commands warn that the repository requires
a newer supported Node patch. These results do not replace validation on the pinned release runtime.

## Remaining gates and costs

Both `rtk proxy pnpm dev:agent -- --session unit17-editor --fixture tui-navigation` and
`rtk proxy pnpm dev:tui:agent -- --session unit17-tree --fixture tui-navigation` fail at Node asset
staging. The desktop attempt measures a 3,076,666-byte static service graph against a
3,062,000-byte ceiling. The PTY driver encounters the same gate. Stop commands confirm neither
isolated session is running. The budget is unchanged. Screenshots, visible native keyboard/reveal
behavior, and the real external-editor process remain unverified; the TUI composition test uses a
synthetic channel behind the actual PTY Rectangle and emulator.

The tree still rebuilds its flat data projection and reconciles the complete keyed item collection;
only drawn rows are bounded. No incremental hierarchy index is introduced. Listing refreshes remain
small ordinary reads and are fenced on completion rather than cancelling a hypothetical shared
reader. A pathless event can issue one read per loaded directory. No canonical body, dirty draft,
undo state, offline cache, or unopened directory is trimmed to obtain these counts.

Concurrent agents own Docker, workflow, and other performance changes. This unit stages its own
files and only its row in the shared performance index. It does not start the next assignment.
