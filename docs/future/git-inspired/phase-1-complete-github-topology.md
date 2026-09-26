# Phase 1: complete and honest GitHub topology

Status: not started, 2026-09-26. Waits on phase 0.

## Goal

The GitHub plugin mirrors every page GitHub makes available for a pull request's detail and files,
preserves provider order, and publishes each resource atomically. A response says whether its
topology is complete. GitHub's 3,000-file REST ceiling is visible as an incomplete result rather than
a 3,000-file pull request. Patch content has an identity that includes the change, and the client can
distinguish omitted content from a file that has no patch.

This phase makes the current full-document renderer correct. It does not yet introduce segmented
rendering or lazy comment bodies.

## Why this phase

The current mirror's fixed `first` and `per_page` values can delete rows from a previously fuller
mirror and advance `sync_state` as though the refresh were complete. Any renderer work built on that
contract would encode truncation into its topology. Phase 2 also needs stable file order, content
keys, and a trustworthy complete set of thread anchors.

## Scope

In:

- Cursor pagination for every GraphQL connection in the PR detail composite, including nested review
  thread comments and latest-commit check contexts.
- REST pagination for pull-request files, up to GitHub's documented 3,000-file maximum.
- An explicit incomplete result for the compare endpoint's documented 300-file changed-file ceiling.
- An authoritative or conservative completeness outcome for detail and files.
- Stage-then-swap mirror writes. A failed page never replaces the previous resource.
- Provider order stored explicitly on files and every ordered detail child where display order
  matters.
- A patch content digest, explicit patch availability, bounded blob-write concurrency, and integrity
  failure when an available blob is missing.
- Response envelopes and UI copy for incomplete resources.
- The single-PR, batch-prefetch, and stale-while-revalidate paths sharing the same fetch and mirror
  helpers.
- Query-key version changes for persisted response shapes that gain required fields.

Out:

- Compact row counts, segments, near-viewport fetches, or plain-first rendering (phase 2).
- Lazy Markdown bodies. This phase may fetch all bodies while traversing topology; phase 2 splits
  topology from content for the diff, and phase 5 does so for conversations.
- Working around GitHub's 3,000-file upstream ceiling through git clones or archive downloads.
- Publishing a partly fetched new revision after a provider or rate-limit failure. Existing stale
  data remains usable under the normal freshness contract; a cold read fails honestly.

## Public result contracts

Add a GitHub-owned completeness type in `plugins/github/src/shared/api.ts`. Reuse the vocabulary from
`docs/data-sources.md`, but do not couple pull-request routes to the dashboard data-source execution
types.

```ts
export type PullTopologyCompleteness =
  | { kind: 'complete' }
  | {
      kind: 'incomplete'
      cause: 'upstream-cap'
      resource: 'files' | 'compare-files'
      received: number
      reportedTotal: number | null
      limit: number
    }

export type PullDetailResponse = {
  detail: PullDetail
  completeness: PullTopologyCompleteness
}

export type PullFilesResponse = {
  files: PullFile[]
  completeness: PullTopologyCompleteness
  reportedTotal: number | null
}
```

The exact envelope names may follow current route naming, but arrays must not carry hidden
completeness in headers or infer it from their length. The batch response carries both envelopes per
pull request. A provider failure is a refresh failure or stale state, not a new partially published
topology; do not overload completeness with freshness.

`PullFile` gains:

```ts
type PullFile = {
  // existing fields
  position: number
  patchKey: string | null
  patchState: 'available' | 'unavailable'
  patch: string | null
}
```

The invariants are:

- `patchState: 'available'` means `patchKey` names a content-addressed blob. A summary response may
  still set `patch: null` because content was not requested.
- `patchState: 'unavailable'` means GitHub omitted the patch. `patchKey` and `patch` are null. The UI
  renders its existing no-diff state.
- A full or per-path read of an available patch must return its body. A missing blob is an integrity
  failure that triggers repair/refresh; it must not be translated to `unavailable`.
- `sha` continues to identify the new-side file blob for whole-file context. It is not the patch key.
- `position` is the zero-based provider order and is the only ordering used on readback.

Use a cryptographic content digest or an equally collision-resistant full diff revision as
`patchKey`. Hash the exact patch bytes. Including only head SHA, path, additions, and deletions is not
sufficient: different patch text can share all four.

The compare response carries the same completeness vocabulary with resource `'compare-files'`.
Keep compare commit pagination separate from changed-file completeness because GitHub paginates
commits but returns its at-most-300 file list only on the first page.

## Fetching the complete GraphQL composite

Split the current monolithic `PR_FRAGMENT` into a scalar/core selection and explicit connection
fetchers. The first request may fetch the first page of several connections, but every connection
must request `pageInfo { endCursor hasNextPage }`, and all subsequent pages go through one cursor
walker.

Connections to traverse:

- labels,
- reviews,
- requested reviewers,
- issue comments,
- commits used by the conversation,
- review threads,
- comments within every review thread,
- status/check contexts on the latest commit.

Request up to 100 nodes where GitHub permits it. The walker:

1. accepts an `AbortSignal`, connection name, page fetch callback, and identity callback,
2. records every cursor and fails on a repeated cursor with `hasNextPage: true`,
3. de-duplicates by GitHub node identity while preserving first provider order,
4. refuses a page whose shape is inconsistent rather than dropping malformed nodes,
5. returns only after exhaustion,
6. and never mutates the mirror as pages arrive.

Nested comments are a second traversal keyed by the stable thread node ID. Run them with bounded
concurrency so 400 threads do not create 400 simultaneous GraphQL requests. Check contexts receive
the same treatment. Record request/page/item counts through GitHub telemetry using fixed connection
labels and numeric values only.

The existing batch endpoint currently gains efficiency from one multi-alias query. Keep an initial
multi-alias scalar/page request only if its GraphQL cost remains bounded. Every stale PR must then go
through the same continuation helper as a single-PR refresh. Do not keep a faster batch-only path
that truncates connections.

GraphQL partial-data responses with errors do not qualify as a completed refresh. Log the bounded
provider error detail through the existing scrubbed logger, preserve the old mirror, and return the
route's normal failure/stale behavior.

## Fetching all available files

Fetch `per_page=100` pages in order. Stop when any of these holds:

- a page contains fewer than 100 files,
- the authoritative changed-file count has been reached,
- page 30 has been consumed, which is GitHub's documented 3,000-file ceiling.

Add `changedFiles` to the PR scalar projection or obtain an equivalent authoritative count. If the
count says more files exist than were returned at the ceiling, completeness is `incomplete` with
`upstream-cap`. If no authoritative total is available and page 30 is full, be conservative and
report `incomplete` with `reportedTotal: null`; a full last page does not prove exhaustion.

Reject a duplicate path or inconsistent repeated file rather than silently overwriting it. Assign
`position` as pages are joined. Preserve a rename's current path as the primary identity, as today;
phase 2 may carry the old path as metadata if the upstream response exposes it.

Patch blobs are safe to write before the SQLite swap because their keys are content-addressed and an
orphan is only cache data. Hash and write them through a small worker pool as pages arrive, then wait
for every required write. If a page, hash, or blob write fails, do not touch `pr_files` or the files
sync row. Once all writes succeed, replace the file metadata and sync state in one database batch.

## Compare-preview completeness

`plugins/github/src/server/routes/pulls/prCreate.ts` currently forwards the compare endpoint's files
as though the array were exhaustive. GitHub documents a maximum of 300 files for the whole compare,
present only on the first response page. Preserve the existing commit pagination/prefill behavior,
but wrap the file list in an explicit completeness result. If GitHub supplies no authoritative
changed-file total and the response contains 300 files, report `upstream-cap` conservatively.

The create form may still use `aheadBy` and commit subjects. The preview and its file-count copy must
say that only the first 300 changed files are available when capped. Phase 2 translates this bounded
result into the shared segmented document instead of restoring a full-patch client adapter.

## Atomic mirror and stored completeness

Extend the GitHub plugin's mirror metadata so a resource sync row can retain:

- completeness kind,
- incomplete cause when present,
- received item count,
- reported total when known,
- the applicable upstream limit.

These may be nullable columns on `sync_state` or a dedicated GitHub mirror-state table. Choose after
checking every `sync_state` writer. The rules matter more than the table:

- the pull detail and all its child tables change in one `db.batch`,
- the file table and its state change in one `db.batch`,
- `fetchedAt` advances only with that swap,
- a refresh failure leaves the old rows, old completeness, and old `fetchedAt` unchanged,
- an upstream-cap outcome is a successful refresh of an explicitly incomplete resource,
- reads order child rows deterministically rather than relying on SQLite insertion order.

The detail children that form a conversation need stored provider order or a stable timestamp and
identity tie-break. File order requires the explicit `position` column. Do not add one generic sort
column without defining its meaning per table.

The repository currently carries one reset-era GitHub migration. Follow the current migration policy
at implementation time: update the schema, generate the migration in the form the repo expects, and
test a fresh plugin database. Do not hand-edit the Drizzle snapshot without running its consistency
check.

## Client behavior

Update all query factories and cache writers to use the envelopes. Change the affected query keys
because a persisted summary written before required completeness and patch-state fields can survive
for a day.

Until phase 2 puts completeness on the shared source port, `DiffForPull` owns the files warning. Use
an existing `Alert`/status primitive above the diff:

- known total: “GitHub returned 3,000 of 3,418 changed files. The remaining files are outside the
  GitHub API limit.”
- unknown total: “GitHub may have more changed files than the 3,000 returned by its API.”

The warning remains visible in the file list and diff view. File counts and “all files viewed” style
claims use the received count and do not imply exhaustiveness. The conversation needs no partial
warning once every GraphQL connection is exhausted; a refresh error follows the existing stale/error
vocabulary instead.

`DiffForPull.cachedFile()` treats an unavailable patch as resolved and an available summary with no
body as missing content to fetch. The patch endpoints maintain request order and distinguish a
missing path from an unavailable patch. Do not seed a full-patch query cache with summary objects.

## Code touched

- `plugins/github/src/server/routes/mirror/prMirror.ts`: paged fetchers, staged aggregate types,
  patch digesting, ordered mirror rows, integrity reads.
- `plugins/github/src/server/routes/pulls/pullRefresh.ts`: one complete composite helper and one
  complete files helper.
- `plugins/github/src/server/routes/pulls/pullsBatch.ts`: reuse of those helpers and envelope output.
- `plugins/github/src/server/routes/pulls/pullDetail.ts` and `pullFiles.ts`: stored completeness and
  route envelopes.
- `plugins/github/src/server/routes/pulls/prCreate.ts` and `client/ComparePreview.tsx`: compare-file
  completeness and visible capped-result copy.
- `plugins/github/src/node/schema.ts` and `plugins/github/migrations/`: order, patch identity/state,
  and mirror completeness.
- `plugins/github/src/shared/api.ts`, `client/queries.ts`, `client/prefetch.ts`,
  `client/DiffForPull.tsx`, and PR detail models: envelope and required-field migration.
- `packages/node-core/src/server/blobs.ts` only if the general blob-key helper remains the right owner;
  otherwise keep the GitHub patch-content key in the GitHub plugin.
- Existing focused tests beside these files.

## Tests

Provider fetch tests use deterministic mock pages and assert requests, cursors, ordering, and final
aggregates:

- 2,200 files produce 22 REST requests and 2,200 ordered rows.
- 3,000 of a reported 3,000 files is complete; 3,000 of a reported 3,418 is `upstream-cap`; a full
  page 30 without a reported total is conservatively incomplete.
- 400 review threads, a thread with more than 100 comments, more than 100 commits, and more than 50
  checks are all exhausted.
- A 300-file compare with no proof of exhaustion is incomplete and never says all changed files are
  shown; a smaller compare is complete.
- A repeated GraphQL cursor, duplicate file path, malformed page, partial GraphQL error, or failure
  on a middle page fails the new refresh.
- Bounded concurrency never exceeds its configured limit.

Mirror tests use the real migrated GitHub database:

- Seed a complete old mirror, fail page 12, and assert every old row, sync timestamp, and
  completeness field remains unchanged.
- Complete a refresh and assert child replacement and sync state are atomic and ordered.
- Store two different patches for the same head blob SHA and assert each pull/file row reads its own
  body through distinct content keys.
- Delete an `available` patch blob and assert a full read reports an integrity failure rather than
  `patch: null`.
- Summary reads perform no blob `get` and retain `patchState: 'available'`.
- An unavailable file causes no blob write and returns the no-diff state.

Route/client tests cover the single, batch, summary, per-path, and force-refresh paths, the query-key
version bump, the incomplete warning, and the absence of a false “complete” claim.

## Docs owed

Per [docs-migration.md](./docs-migration.md): `docs/github-integration.md`, `docs/api-reference.md`,
`docs/data-layer.md`, `docs/caching.md`, and `docs/testing.md`.

## Done when

- A mocked 2,200-file/400-thread pull request reaches the mirror with every available identity and in
  provider order.
- No fixed `first` or one-page `per_page` call can be mistaken for exhaustion.
- A failed continuation cannot replace or age the previous mirror.
- The client can state complete versus upstream-capped and can distinguish summary omission,
  unavailable patch, available patch, and integrity failure.
- The create-PR compare preview reports its separate 300-file upstream ceiling honestly.
- Patch blobs with the same head SHA but different content cannot collide.
- `pnpm lint`, the GitHub plugin suite, relevant query-persistence tests, and `pnpm test` pass.

## Verify before building

- Enumerate every connection and nested connection in the current `PR_FRAGMENT`; GitHub may have
  added fields since this plan was written.
- Confirm GitHub's current maximum page size and 3,000-file cap in its official REST documentation.
- Confirm the compare endpoint's current first-page-only 300-file contract in official documentation.
- Confirm the GraphQL API's current cursor and node-cost rules before choosing concurrency.
- Find every writer and reader of `plugins/github/src/node/schema.ts` `syncState` before extending it.
- Find every call to `fetchFiles`, `mirrorFiles`, `mirrorPr`, `readComposite`, and `readFiles`; the
  single and batch paths must migrate together.
- Confirm how `serveThenRevalidate` represents stale refresh failure so completeness and freshness do
  not become one field.
- Inspect `packages/client-core/src/infra/persistence/queryPersistence.ts` and bump every persisted
  query key whose successful data gains a required field.
- Run `pnpm db:generate` according to the current reset-era migration policy; do not assume the
  migration filename in this document still exists.
