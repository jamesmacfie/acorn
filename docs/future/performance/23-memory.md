# Memory file reads, change feed, and UI work

Date: October 3, 2026. Status: revised investigation and implementation candidates; unit 23.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Review the cumulative result through unit 22 before implementation. This revision is
based on source inspection, with no fresh timing, heap, or native UI benchmark.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md),
[the deferred work](./refused.md), and [notes and memory](../../notes-and-memory.md).
Trace the production owner before choosing a change. Select fixes only after a disposable workload
reproduces their cost, and record when the cost is too small to justify added machinery.

## What the overhaul retired

The October 1 assignment optimized database reconciliation: delta writes to SQLite and full-text
search, recall statistics, joined source reconciliation, and Findings approval receipts. Those
owners were removed on October 2. None of that database work remains an implementation requirement.

[Investigation 14](../../../plans/performance/14-background.md),
[the original review brief](../../../plans/performance/implementation-23-review-brief.md), and
[the implementation sequence](../../../plans/performance/implementation-plan.md) retain historical
provenance. Their Memory measurements describe the retired implementation. Do not compare those
timings with a file-scan implementation and claim an improvement from this unit.

Fresh filesystem reads, avoiding duplicate work, bounding concurrent reads and retained bodies,
and preserving scope and lifecycle still matter. The opportunities below apply those concerns to
the direct-write store and its desktop and terminal consumers.

## Production owners and data flow

| Owner | Work and consumers |
| --- | --- |
| `plugins/memory/src/server/memory.ts` | Reads and parses Markdown files, renders indexes, and atomically replaces files. Each scope scan reads every valid memory body. |
| `plugins/memory/src/server/memoryStore.ts` | Lists, searches, gets, history, feed, and hash-checked mutations. Writes serialize per data root and regenerate the scope index and change log. |
| `plugins/memory/src/server/knowledgeChannel.ts` | Projects file rows into the HTTP list/search response, including bodies and content-derived IDs. Loads the store on first use. |
| `plugins/memory/src/server/standingContext.ts` | Builds capped indexes from a full store list for session admission and the page preview. Session resume uses the stored snapshot. |
| `plugins/memory/src/server/memoryImport.ts` | Previews source files and destination collisions, then writes each selected memory through the store. |
| `plugins/memory/src/client/MemoryCenter.tsx` | Loads list/search results, derives scope tabs, and resolves each displayed row. Mounts either the overview or a reader. |
| `plugins/memory/src/client/memoryResource.ts` and `plugins/memory/src/client/memorySelection.ts` | Own page reads and a shared revision signal. Node frames and local mutation completions both trigger refreshes. |

HTTP reads go through `plugins/memory/src/server/routes/knowledge.ts`, the custody broker, and
the client `readJson`/`writeJson` API. The Memory page uses Solid resources rather than a shared
TanStack memory query. Its list, feed, context preview, and reader/history make independent requests.
The shared frame subscription avoids duplicate subscriptions; it does not merge those requests.

Agent tools use the store directly after resolving the signed task's project. The `memory.library`
capability supplies complete entries to plugin consumers. Keep it separate from a display-only list
projection. The Node owns files and mutation ordering; clients own selection, drafts, and rendering.

## Candidates in priority order

### Reduce change-feed reads

`MemoryStore.feed` reads the change log once, then calls `get` for each latest displayed address.
Each successful `get` rereads and parses the whole log to attach session attribution. If the hash
matches and the change has a previous version, `feed` calls `history`, which reads and parses up to
20 historical bodies to test whether that one version exists.

For 50 distinct latest entries whose current hashes match and whose histories each contain 20
versions, the source implies 51 change-log reads and up to 1,000 history-body reads in one feed
request. These are conditional operation counts, not measured latency. The parallel feed checks
can also start many history reads together.

Read the log once per feed operation and reuse its attribution and latest-change lookup. Check the
current file hash without constructing a fully attributed document. Check the referenced history
file's availability through the same safe path rules without loading all history bodies. Preserve
the distinction between a history entry existing and its content being usable by Undo.

Acceptance: identical feed order, attribution, and Undo eligibility; one log read per feed operation;
no unrelated history bodies read for eligibility. Undo must still recheck latest change, current
hash, and retained prior content under the root lock. Cover external edits, deleted memories,
pruned or missing history, unsafe paths, and a write racing the feed.

### Control UI request volume and inactive reads

The list filter is a resource source with no debounce, so each input change starts a server search
and full file scan. The palette already uses the host's 250 ms debounce and two-character minimum,
despite the older comment in Memory's command file. Its query handler does not forward the host's
abort signal to `memoryApi.search`, so superseded requests can keep doing transport and Node work.
`memoryRevision` invalidates the mounted resources for every memory frame, including changes to
another project. Local mutation handlers also bump it in `finally`, including failed operations;
a successful operation can therefore refresh through both its Node frame and local completion.

Measure a typing burst and an agent/import write burst. Apply a short debounce to the list filter
if it removes meaningful requests. Preserve the immediate clear-filter behavior and the final query.
Forward read cancellation where the transport supports it; verify separately whether the Node scan
actually stops. Keep the palette's host debounce. Coalesce refresh bursts and use event scope/project data
to avoid unrelated project refreshes. Private changes still affect each project's private library.
Do not suppress a relevant frame merely because a local operation also finished.

`MemoryContext`, `MemoryImport`, and `MemoryDetail` create preview, source-discovery, and history
resources before their folds open. The DOM `Fold` already defers child construction until first
open, but these outer resources still fetch. Consider starting those reads on first disclosure and
marking closed sections stale until reopened. Check both host implementations before changing fold
control. Preserve form drafts and source choices across close/open.

Acceptance: count list/search/feed/preview/history/source calls across typing, one local save,
an unrelated project write, and a burst of relevant writes. The final visible state must include
every acknowledged mutation. Delayed obsolete reads must not replace another query, address,
project, or Node's data or error state. Closing a view cancels its disposable reads, not a write
or another consumer's shared work. A refresh failure must not erase a draft.

### Remove repeated list derivation before adding virtualization

`MemoryList.inScope` filters the entire collection on each call. Each row renderer calls it and
then performs `find` by key; repeated row lookups can perform quadratic work in a large library.
The list also sorts the Node's already ordered list response again and rebuilds collection items.
The shared `Rows` component already preserves unchanged item identity, so do not replace that owner.

Memoize the scope partitions and key-to-row lookup once per result set. Use those values for tab
counts, item projections, row lookup, and selection. Preserve newest-first page ordering and
relevance ordering in the palette; the page deliberately sorts search matches by update time.

Measure row construction, reactive derivation, DOM nodes, and TUI painting before considering
`Rows` virtualization. Its DOM virtual path uses fixed heights, while memory rows stack a name and
description. Verify height, narrow layout, keyboard reveal, collapsed rail, and terminal behavior
before enabling it. Keep every memory reachable; pagination or truncation is a product/API change.

Acceptance: derivation and lookup work scales with result count, unchanged rows remain mounted,
and filtering or refetching preserves selection, keyboard navigation, and the open editor.

### Separate display payloads from complete memory content

The HTTP list and search responses use `MemoryRow`, including body and filesystem path. The list
and palette render names, descriptions, types, scopes, and dates. The reader fetches the selected
body separately through `get`. Agent `memory_list` likewise discards bodies after a full store scan.
Standing context needs names and descriptions, but also starts with a full store list.

A summary projection can reduce response serialization, broker copies, JSON decode work, and client
retention. For a 300-file fixture with 4 KiB bodies, the list carries about 1.17 MiB of body content
before metadata and JSON overhead. This is workload arithmetic, not a measured response size.
Measure the actual bytes and allocations before selecting the change.

Add an explicit compact display projection if justified. Preserve the body-bearing public capability
and HTTP contracts through the documented compatibility mechanism; do not silently remove fields
from `MemoryRow` or change content-derived IDs. Keep search matching on full bodies even when the
display response omits them. A compact response alone does not reduce Node file reads.

For metadata-only store consumers, investigate a separate scan projection only if body reads dominate.
Frontmatter parsing has a body-derived description fallback, and external edits affect ordering.
Do not substitute generated `MEMORY.md` for a fresh scan: hand edits do not regenerate that file.

Acceptance: smaller measured list payload and retained client data; exact search answers, ranking,
IDs, index text, legacy type mapping, and external-edit behavior. Full content remains available to
the reader, search, imports, history, and capability consumers.

### Reduce repeated scans without weakening freshness

`scanMemoryDir` processes files sequentially within each scope, with `lstat` and a parallel
`readFile`/`stat` per file. A list and context-preview request scan the same scope folders separately.
Every mutation regenerates the affected scope index by reading all its files. The library capability
also loads both scopes before discarding the unwanted one.

Start with request-local reuse and avoiding the unused scope. Investigate a small bounded scan worker
pool if filesystem wait dominates. Measure descriptors, peak bytes, CPU, and concurrent agent/page
requests as well as elapsed time; a faster isolated scan can make the shared Node busier.

Sharing an in-flight scan or retaining parsed files is conditional work. Key reuse by data root,
project, requested scopes, and mutation generation after each caller's authorization. A read admitted
after an acknowledged write cannot join an earlier scan. External changes also need revalidation;
a generation increment for Acorn writes alone cannot detect them. Directory entries and file identity
must account for additions, removals, atomic replacement, same-size edits with restored mtime,
permission changes, and symlinks. Keep direct reads if reuse cannot prove that contract.

Any retained parse cache needs explicit byte and entry bounds, an owner and disposal path, and
mutation invalidation. Measure settled idle retention. Do not introduce watchers, timers, a database,
or a cross-Node cache just to avoid a scan. Do not cache signed-task or project authorization.

Acceptance: fewer repeated file reads or shorter scan time with exact answers and bounded resources.
Fresh session admission sees the applicable index; resume retains its original stored snapshot.

### Investigate bulk import only after ordinary reads

Import preview calls the fully attributed `get` for each destination. Import execution rebuilds that
preview and writes each accepted file separately. Each write scans the growing destination folder,
rewrites the bounded change log, and emits a change frame. Importing many files can therefore cause
quadratic aggregate scan work and repeated visible-page refreshes.

Reuse one operation's collision/log lookup and a name-to-preview map where fresh hash checks permit
it. UI burst coalescing may address the visible cost without changing import durability. Batch index
or event publication only after defining failure and crash behavior: successful files stay imported,
each change retains history and attribution, and completion cannot precede its required durable index
and log. Keep single-memory writes atomic and hash-checked under the root lock.

Acceptance: compare an import of 50 files into an empty and populated project. Count file reads,
index/log replacements, events, and UI requests. Cover collisions, overwrite, a destination changed
after preview, invalid files, partial failure, and final standing context. Source files stay unchanged.

## Fresh evidence and verification

Use disposable Node data and synthetic files. Suggested fixture sizes are 30 and 300 memories with
4 KiB bodies, split between private and project scope. Add 50 distinct latest changes, histories with
20 versions, and a populated change log up to its 1,000-entry retention bound. These sizes exercise
the owners above; they are not a claim about typical libraries.

Record a baseline at the production entrypoints for these operations:

- Cold page open, five refreshes, opening a reader, and opening previously closed disclosures.
- A typed filter and palette query, including matches found only in a body and ten-result ordering.
- Overlapping list, search, context-preview, and feed reads, followed by an acknowledged agent write.
- Get, save, delete, Undo, history, and restore with a preserved owner draft.
- Import preview and execution, plus repeated navigation and settled idle retention.

Measure file and log reads, parse/hash work, index/log writes, active filesystem operations, HTTP
requests and bytes, row construction, CPU, elapsed time, peak allocation, and settled retained heap.
State which quantities are instrumented, source-derived, or estimated. Native visible latency needs
a focused real Tauri window; jsdom and operation counts do not establish that result.

Use paired source/probe hashes and identical workloads for each selected fix. Preserve October 1
artifacts unchanged and label them superseded for Memory. New probes must invoke the direct-write
owners, not removed reconciliation functions. Add lasting behavior tests only for the selected
change's risks and run these checks:

```sh
rtk pnpm --filter @acorn/plugin-memory test
rtk pnpm --filter @acorn/arch-tests test
rtk pnpm lint
```

For UI changes, run the real Tauri and isolated PTY workflows in
[local development](../../local-development.md). Exercise the library, filter, feed, disclosure,
editing conflict, history, Undo, and palette. Stop both sessions. Check Node A/B with identical
memory names if a client cache or shared request owner is introduced. The coordinator runs the
bounded full suite and sustained-use acceptance after the selected fixes.

## Completion and handoff

Implement only reproduced costs. Record before/after counts and timings, resource costs, selected
and deferred candidates, and remaining limits under `plans/performance/`. Update the owning shipped
docs for any route, capability, import, or freshness contract change. A small-library result may
justify leaving conditional cache, virtualization, or batch-import work deferred.

## Verify before building

- Re-read the merged source and check which candidates earlier work already addressed.
- Confirm signed-task scope, originating Node, file authority, write ordering, and stored prompt snapshots.
- Preserve path safety, external edits, stale-hash conflicts, history retention, and unsent drafts.
- Verify the shared Solid runtime and both hosts' fold/row behavior before trusting UI probes.
- Capture fresh production baselines and select the smallest change that removes a reproduced cost.
- Run relevant tests and lint, and coordinate native, PTY, and sustained-use verification.
