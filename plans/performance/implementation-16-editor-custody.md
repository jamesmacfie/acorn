# Editor custody implementation record

Date: October 2, 2026. Unit 16. Scope: file editor and host document saves, recovery,
reloads, preview retention, and lossless text reads. The requested future handoff is deleted.

## Ownership and compatibility

`packages/client-core/src/features/editor/documentCustody.ts` owns each complete document address.
It retains acknowledged and current CodeMirror text, the edit revision, one active write, one
requested follow-up writer, recovery, and retained editor state. Repeated flushes do not queue
closures holding obsolete full strings. Clean saves skip transport and hooks. Different document
addresses admit independently. Failed writes reject and retain the latest full text.

The file response adds optional `text` and `revision` fields. The Node returns the exact string
passed to `writeFile` after hooks and its SHA-256 over UTF-8 bytes. No post-save reread is used as an
acknowledgement. A formatter replacement applies only to the submitted local revision; later edits
win. Old clients ignore these fields. An old Node omitting exact text produces an unverifiable save
message and keeps the client dirty instead of silently claiming the submitted body persisted.

`editorClient.ts` captures the QueryClient origin at construction, including root prefetch. Null
keeps the browser serving origin; it does not fall through to an incoming selected Node.
`editorDocumentPool.ts` owns file view-state leases and admits final writes on model retirement.
Retirement does not re-create a closed pool entry or mark an incoming Node's equal-ID document clean.
`EditorPane.tsx` handles view adoption, canonical preview membership, guarded reloads, and optional
presentation. Its pre-existing large component remains the UI owner; write admission and pool
retirement are extracted into dedicated small modules.

`DocumentSurface.tsx` uses the same custody owner. Flush joins persistence and rejects failure or
an edit during the wait. Commands cannot proceed on that rejection. Autosave and retirement catch
failure while preserving recovery. A retired handle rejects calls; a remounted surface acquires a
fresh handle and writer. Recovery holds content rather than frame authority. The 2 MiB UTF-8 host
wire ceiling remains enforced for writes, without a dirty-text eviction cap.

Full dirty and acknowledged text plus cursor and scroll are stored in device recovery storage.
Undo state remains in memory across pane and model retirement. No recovery timer automatically
replays an offline mutation. Storage refusal preserves the full in-memory document and displays a
recovery error. Process restart cannot restore undo history or a recovery record refused by storage.

## Changed owners

- Client-core editor custody, document surface, document view-state eviction, and tests.
- Plugin API's editor facade exports for the shared custody owner.
- Editor file API, pool lifecycle, pane save/read/reload lifecycle, and view-state retirement.
- Editor Node bridge and additive write result contract, with real-filesystem route tests.
- `docs/editor.md` and the unit 16 row of the performance programme index.
- Fresh evidence, hashes, and a migrated editor probe under `plans/performance/`.

The Node reader uses fatal UTF-8 decoding with BOM preservation and rejects NUL-containing binary
bodies. Valid replacement characters and a complete 17 MiB file round-trip. Failed file reads show
a load error with a read-only surface. The host document ceiling is not imposed on file reads.

## Matched evidence

Fresh cumulative baseline: `12-*-unit16-before.json`, source/config hashes in
`unit16-before-hashes.json`. The baseline runs actual EditorPane, host DocumentHandle, CodeMirror,
and the actual API client during a keyed Node swap. Transport and unrelated sidebar panels are
synthetic. The probe config aliases the installed Solid and Solid Query ESM entries and deduplicates
Solid; every renderer fixture uses a normal QueryClientProvider. These are jsdom measurements,
not native renderer latency.

Accepted source: `unit16-after-hashes.json`. Accepted results: `12-*-unit16-complete.json`.
The historical `12-editor-probe.test.tsx` is unchanged. The migrated
`unit16-editor-probe.test.tsx` introduces an actual edit before its save-triggered held marker test,
because a clean save deliberately stops triggering marker work. Intermediate after and failed-run
artifacts remain labeled separately.

| Supported workload | Before | Accepted result |
| --- | --- | --- |
| 24 clean 64 KiB previews | 24 pooled files, 1,573,430 retained characters | 1 pooled file, 65,560 retained characters |
| Two edits with held writes | 2 writes admitted concurrently; earlier body can win | 1 write admitted; latest follow-up wins |
| Failed close | Dirty tab removed | Dirty tab and full buffer retained |
| Focus read held across typing | External body replaces human edit | Human edit wins |
| Second identical host flush | Resolves before first acknowledgement | Remains pending until acknowledgement |
| Failed host flush | Resolves | Rejects with dirty text retained |
| Outgoing Node A pane teardown after selecting B | Sends through Node B | Sends through captured Node A |
| Optional held markers | File text waits | Text opens before markers |
| Failed file read | Editable empty saved document | Error and read-only surface; no fabricated write |

The clean-preview probe measures process CPU separately. Baseline CPU is 783.834 ms; accepted CPU is
1,532.497 ms. Removing an extra whole editor reset during tab loading reduces a subsequent isolated run to
1,350.920 ms, preserved in `12-preview-retention-unit16-cpu-final.json`. The 2,285.598 ms
intermediate run remains in `12-preview-retention-unit16-after-cpu.json`. These runs overlap independent agents in this shared
checkout, and include jsdom/editor work. The pre-reset-removal accepted run remains labeled
`unit16-accepted` at 2,144.554 ms. They establish a retained-content reduction, not a CPU or
visible-latency improvement. CPU increased in this fixture and needs a quiet cumulative replay.
Recovery adds full dirty-text storage and retains undo state intentionally; those bytes are not an
optimization target.

## Verification

Commands use the repository-required `rtk proxy` prefix.

- `pnpm --filter @acorn/plugin-editor test`: 13 files, 70 tests pass, including exact formatter
  acknowledgement/veto, invalid UTF-8, BOM, valid Unicode, large full bodies, clean save admission,
  close retry, editing during close, reload races, retirement recovery, preview retirement, and
  captured API origins.
- `pnpm --filter @acorn/client-core exec vitest run src/features/editor src/host/frames/broker.test.ts
  src/host/frames/frameServices.test.ts`: nine files, 116 editor and document bridge tests pass.
- `ACORN_PERF_TAG=unit16-complete pnpm --filter @acorn/plugin-editor exec vitest run --config
  ../../plans/performance/unit16-probe.config.ts`: 10 actual component/handle/API matched probes pass.
- `pnpm --filter @acorn/plugin-editor lint` and `pnpm --filter @acorn/client-core lint`: targeted
  TypeScript checks pass.
- `pnpm lint`: attempted repeatedly; the combined checkout fails oxlint on unused `desc` and `sql`
  imports in `plugins/agents/src/server/sessions/sessionRepository.ts`, outside this unit's files.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts
  entrypoints.test.ts`: 59 boundary and documentation-path tests pass after record creation.
- `pnpm dev:agent -- --session unit16-editor`: native staging fails at the Node service static bundle
  gate, 3,080,127 bytes against a 3,062,000-byte ceiling. No native window launches. The stop command
  confirms that the session is not running. No size gate is raised or unrelated source changed.

## Remaining integration and limits

The user assigned unit 16 while other agents implemented units in the same branch. Units 14 and 15
were still pending in the programme and their marker identity contract was absent from production
source. The editor implements local document/read/marker generation fences and clears disk
annotations on local edits, but exact disk-body provenance integration requires unit 15. Generation
checks alone cannot establish that a provider's ranges describe the displayed body during an
external write. This prerequisite conflict was surfaced before edits and through an asynchronous
user question; no alternative provenance cache or provider contract was invented here.

Native screenshots and interactions remain blocked by the combined branch's service bundle gate.
The repository lint result is likewise a combined-checkout gate, not a passing unit claim. No
application subagents, branches, normal profiles, paid providers, or external messages were used.
The shared programme index is committed only for the unit 16 row; other agents' edits stay with
those agents. Sustained-use and two-Node native validation remain programme-level acceptance.
