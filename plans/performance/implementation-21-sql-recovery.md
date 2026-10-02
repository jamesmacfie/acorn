# SQL scratch byte limits and recovery

Date: October 2, 2026. Status: implemented. Native desktop and PTY acceptance remain blocked by
the Node service bundle gate. This record replaces the unit 21 handoff.

## Owners and compatibility

The loaded Database plugin owns `db_scratch`, validation, completion input, and generated SQL.
Its declared scratch routes carry the task scope through the Node carrier. Host transport captures
the Node, and the composed document handle remains a structural grant to that scope. The host
owns edit custody, flush admission, undo, and export. No migration or row rewrite is required.

The recovery flow was declared before editing: a complete authorized scratch GET lands in the host;
an oversized stored row exposes recovery instructions and a desktop **Export full text** action;
no editor or execution handle is published. Export uses the host save-file seam on those exact bytes.
The original authenticated GET remains a compatible headless/terminal export route. An explicit
valid PUT replaces the row, after which reopening creates an editor. No plugin path or general
network authority is added.

`document.write` gains optional `expectedText`. The broker compares it and writes synchronously;
a mismatch rejects with `conflict`. Unconditional callers retain their replacement semantics.
This safeguard requires a host with this implementation; an earlier broker ignores the optional
field. Document input still has the shared 2 MiB UTF-8 ceiling. The plugin keeps saved-query,
prompt, execution, token, project-scope, connection, row-write, and result contracts.

## Changes

- `plugins/database/src/server/routes/database.ts`: UTF-8 admission at scratch and completion inputs,
  generated modal output, and the shared durable scratch commit. The palette refuses before success
  selection. Scratch GET/PUT explicitly enforce the portable carrier's task principal as well as
  the host's outer route gate.
- `plugins/database/src/tree/DatabasePanel.tsx`: both Execute paths flush before reading, report
  failures, and gate retirement. Held scratch/table/generation replacements capture host text;
  selection generations discard obsolete loads. Explicit saved picks still join desktop undo.
- `plugins/database/src/tree/GenerateSqlModal.tsx`: await host replacement before dismissal; a
  refused host write leaves the prompt and error visible.
- `packages/client-core/src/features/editor/DocumentSurface.tsx`: export full stored or unsent text
  through the platform seam. Oversized stored content has no editable empty state. Recovered dirty
  text remains editable and keeps in-memory undo even when its persistence is refused.
- `packages/client-core/src/features/editor/documentCustody.ts`: a text edit entrypoint lets the cell
  host use the same serialized save and recovery owner without constructing a graphical state.
- `apps/tui/src/plugins/DocumentSurface.tsx`: shared custody, captured Node/address, byte enforcement,
  and retired handle rejection. Stored oversize reports the authenticated export path.
- `packages/protocol/src/plugin/bridge.ts` and the client bridge SDK/broker: optional atomic text
  comparison for replacements. Authority remains the sibling document grant.
- Tests beside the route, tree, desktop host, broker, and terminal host cover the affected contracts.
  Shipped ownership is documented in `docs/database.md` and `docs/editor.md`. The performance index
  links this record, and the pending handoff is deleted.

The Database panel already exceeds 500 lines because it includes the row editor. This change keeps
that ownership stable; splitting unrelated row editing is outside the SQL recovery assignment.

## Before and after evidence

`unit21-sql-evidence.json` records the baseline commit, original route SHA-256, changed owner hashes,
full workloads, and outcomes. `unit21-sql-before.txt` preserves the failing production route replay.
The replay copied the baseline route beside its real sibling imports and ran the same complete
route test source against it. Temporary source/test copies were deleted after the run.

The baseline route passes 41 of 47 tests and fails six added regressions. Multibyte, emoji, and
combining one-byte-over documents are accepted; oversized palette/modal output reports success;
the standalone portable scratch handler also lacks its own foreign-task check. After implementation,
the route suite passes all 47, and the full Database package passes 107 tests.

The exact ASCII and Unicode cap is 2,097,152 bytes. An extra ASCII byte is refused before durable
replacement and before catalog work. Empty scratch/completion text is accepted. A seeded legacy
row contains 2,097,152 copies of é, totaling 4,194,304 UTF-8 bytes; authorized reads and desktop
export compare complete recovered text. Failed replacement leaves that row intact. A 2,097,153-byte
emoji draft survives desktop retirement/remount and retains undo; an equal task ID on another Node
loads independent text. No shortened fixture stands in for the boundary or export.

Tree tests drive the real remote Solid tree with a synthetic database client. Both the Execute button
and surface action wait for held flushes, execute only after success, and render save/read errors.
A later saved selection and retirement discard held scratch reads. Broker tests use MessageChannel
and prove a changed host buffer refuses guarded replacement. The host suites use CodeMirror in
jsdom under the normal QueryClientProvider; they do not measure native rendering latency.
Terminal cell tests prove failed draft remount, same-ID Node separation, retired handle denial,
and oversized stored refusal without an empty write.

## Verification commands

Commands run through the repository's `rtk` wrapper:

- `pnpm --filter @acorn/plugin-database exec vitest run src/server/routes/unit21Before.test.ts`:
  expected baseline failure, six failed and 41 passed. The temporary test/route files are removed.
- `pnpm --filter @acorn/plugin-database test`: 10 files, 107 tests pass.
- `pnpm --filter @acorn/client-core exec vitest run src/features/editor/DocumentSurface.test.tsx src/features/editor/documentCustody.test.ts src/host/frames/broker.test.ts src/host/frames/brokerLifecycle.test.ts src/host/tree/bridgeAuthority.test.ts src/host/frames/layoutDocumentOwnership.test.tsx`:
  six files, 104 tests pass.
- `pnpm --filter @acorn/tui exec vitest run src/plugins/DocumentSurface.test.tsx`:
  one file, four tests pass.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts`: 59 tests pass.
- `pnpm --filter @acorn/plugin-database lint`: pass.
- `pnpm --filter @acorn/client-core lint` and `pnpm --filter @acorn/tui lint`: pass.
- `pnpm lint`: the initial run stopped on concurrent HTTP work's unused imports. The next run
  completed 31 package checks before concurrent HTTP test type errors stopped the remaining tasks.
  A final cumulative run passes oxlint and all 37 package type checks.
- `pnpm dev:agent -- --session sql-recovery-21`: blocked before desktop launch by service graph
  size, 3,076,898 bytes against the 3,062,000-byte ceiling.
- `pnpm dev:tui:agent -- --session sql-recovery-21-tui --fixture tui-navigation`: the same gate
  blocks launch after disposable seeding.
- Desktop and TUI driver `stop` commands confirm neither session is running. Recorded launcher
  PIDs no longer exist; only these two disposable session directories were removed.

## Costs and limits

Validation adds a linear UTF-8 byte scan at the owning boundary. Explicit export retains complete
legacy text and allocates its encoded byte array. A guarded replacement carries a complete prior
text snapshot over the slot bridge and compares it synchronously; this is a correctness cost, not
an optimization claim. Dirty text/undo remain outside the view, with their established memory and
recovery-storage costs. The terminal host retains text, not CodeMirror undo.

No native screenshot, native file-dialog acceptance, PTY navigation acceptance, visible timing,
PostgreSQL query execution, paid model call, or sustained-use claim is made for this unit. Native
acceptance needs the service bundle gate repaired by its owner and a fresh isolated session.

The task-owned diff passes `git diff --check`. The cumulative branch check still reports a trailing
blank line in concurrently edited HTTP code; that file is outside this commit.
