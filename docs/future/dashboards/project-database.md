# The taskless database connection — the gate under run-once-and-pin

**Unbuilt, and it is a precondition rather than a feature.** `dynamic-collections.md` assumes a saved
SQL query can be exposed as an ordinary collection. It cannot be, and the reason is not plumbing: a
collection is fetched as `fetch(nodeId, params, signal)` and everything about running a saved query is
scoped to a *task*. This file decides the missing piece so that one can be built on a real answer
rather than on an assumption made in passing.

Nothing here is a dashboards change. No panel, no placement and no line of `@acorn/protocol` moves —
the README's invariant holds, and that is the test that this is the right shape for the gap.

## What is actually missing

**A connection.** `resolveDbUrl` (`plugins/database/src/main/database.ts`) loads a task, takes that
task's **worktree**, and resolves the URL in layers against it: a committed `[database].url_script` run
in the worktree, then the worktree's `.env`, then `process.env.DATABASE_URL`. Pools are keyed by task
id. Every layer but the last needs a `root`, and a `root` is a worktree. Panels carry no task at all —
not on Home, and not in the `pane.aside` regions that shipped with `placements.md`; there is no task
id anywhere in `packages/client-core/src/dashboards/`.

So the saved query *rows* exist in the form run-once-and-pin assumes — project-scoped
`db_saved_queries`, `id`/`name`/`notes`/`sql` — and the *execution* does not. Reading the storage
alone makes the gate look met. It is not.

**And types.** A second gap, found beside the first: `toResultSet` keeps `res.fields[].dataTypeID`
nowhere. Columns come back as `string[]` and every cell is flattened through `cell()` to
`string | null` — numbers stringified, dates ISO'd. A pin needs
`{ id, name, type }` in the seven-type collection vocabulary, so today there is nothing to pin *from*
even once there is something to run.

**There is also no "run a saved query by id" route.** Running is always `POST .../query { sql }` with
a string. That one is genuinely just plumbing, and is noted here only so it is not discovered as a
surprise.

## Decision 1 — a panel names a PROJECT, and the node resolves against the project's checkout

Three shapes were available.

**A panel names a task.** Refused. A task is a worktree, and a worktree is a thing people create and
throw away; a Home panel that outlives its task is a panel addressing nothing. Worse, it asks a person
composing a dashboard to name something they think of as temporary, which is the kind of choice that is
wrong six weeks later without anybody having done anything wrong.

**A connection string stored on the project row.** Refused, and this is the one worth being explicit
about. `main/database.ts` resolves the URL per connect and *never persists it* — that is a stated
property of the pane, not an accident. A dashboard panel is not a good enough reason to start keeping
database credentials at rest.

**A panel names a project; the node runs the same layered lookup against the project's own
checkout.** This is the one. Same layers, same precedence, same file formats — a different root. It
needs no new concept, because `projects.path` is already the main checkout and `resolveDbUrl` already
falls back to it for *reading* config (`loadRepoConfig(root ?? project?.path ?? null, …)`); what it
does not do is run the script or read `.env` without a worktree. The shape is a sibling
`resolveProjectDbUrl(core, projectId)` over a shared body that takes a root and a trust check rather
than a task, and a second pool map keyed by project id.

The honest cost: **a dashboard panel and a task pane may resolve to different databases** — the main
checkout's `.env` is not the worktree's. That is correct rather than unfortunate. A Home dashboard is
not looking at anybody's branch, and a panel that silently followed whichever task happened to be open
would be a panel whose numbers changed for reasons nobody could see.

## Decision 2 — a repo-authored script must never run unattended without consent

This is the load-bearing half, and the reason this file exists instead of the change being made inline.

`[database].url_script` is **committed content executed as a shell script**. It sits behind
`assertConfigTrusted` precisely because cloning a repo must not be enough to run its commands. A
collection, meanwhile, *polls*: `refresh` is declared on the contribution, `createSourceState` sets an
interval from it, and the node's `collection-sample` scheduler target samples collections with no
client open at all. Moving resolution to a project is therefore also moving a repo-authored script from
"runs when a person clicks Connect" to "runs on acorn's schedule, with nobody watching".

Two things follow, and neither is optional.

**The trust gate becomes project-addressable.** This turns out to be nearly free, which is a fact worth
recording because it is the reason to take this shape rather than argue for a weaker one: the consent
record in `configAcks` is **already keyed by `projectId`**, and `taskSnapshot` already falls back to
`project.path` when a task has no worktree (`repoConfigTrust.ts`). Only the *lookup* is addressed
through a task. What is needed is a `projectId`-keyed sibling of `repoConfigTrustReview` and of
`assertConfigTrusted` on the `projects` core seam. Same table, same hash, same ack, different address —
so a repo trusted in the pane is trusted for its panels, and revoking covers both. It must not become a
second consent record; two records for one question is how one of them ends up stale and permissive.

**An untrusted script refuses; it does not prompt.** A panel whose resolution needs consent renders as
an unavailable source with the reason, which is machinery the panel already has (`PanelUnavailable` —
one source failing is data, not an error). It must not raise a dialog, because a dialog from a
background poll is a dialog nobody asked for, arriving with no context about what asked for it, and the
habit it teaches is clicking through. Consent is given where the script is visible: the pane, or
project settings.

**The ceiling this leaves, named rather than buried.** A repo script that has been trusted *once* now
runs on a timer rather than on a click. That is a real widening of what trust buys, and it is accepted
only because the consent is explicit, project-scoped, revocable, and attached to a content hash that
re-arms the moment the script changes. If that trade stops looking right, the upgrade path is a
separate opt-in on the project — "this project's database may be read by dashboards" — and not a
weakening of anything above. Scripts the *user* wrote (`dbUrlFromRepo` false) are ungated today and
stay ungated: those are the person's own input.

## Decision 3 — types come off `dataTypeID`, and are never guessed

`toResultSet` starts keeping `res.fields[].dataTypeID`, and a small closed OID table folds it onto the
collection vocabulary: the integer and float and numeric OIDs to `number`, `bool` to `boolean`,
`timestamp`/`timestamptz`/`date` to `datetime`, **everything else to `text`**. A closed table rather
than a catalog lookup, because a type map that needs a round trip is a type map that fails when the
connection is the thing being tested.

`enum`, `person` and `link` are **not derivable from an OID and are not inferred**. A pin is a starting
point a person can accept or correct, not a classifier — and a wrong guess here is worse than no guess,
because it produces a board grouped by something that is not a status.

The consequence to state plainly: **a pinned SQL collection offers stat, list and table — not board —
until somebody says a column is an enum.** That is the cold case moved one step forward rather than
removed, which is less than `dynamic-collections.md` implies when it promises "column names, types and
kanban eligibility". Whether the pin step lets a person promote a text column to an enum is a *wizard*
question and is left open here deliberately; it is not a connection question and this file should not
answer it.

One more consequence, easy to miss: **the collection route must not reuse `DbResultSet`.** `DbCell` is
`string | null` and a collection cell is `string | number | boolean | null` with datetime as epoch
milliseconds. A `number` field whose cells arrive as strings sorts lexically and charts as nothing. So
the collection route projects `PluginCollectionRow`s from the driver rows directly, and the pane's grid
keeps the string path it has — it renders text either way, so nothing there needs to move.

## Build order

1. **The connection.** `resolveProjectDbUrl` over the shared body, the project-keyed pool map with the
   same `endDbPools` shutdown disposal the task map has, and the `projectId` twin of
   `assertConfigTrusted` on the `projects` seam.
2. **The types.** `dataTypeID` retained, the OID table, and the collection-side row projection.
3. **Then `dynamic-collections.md` part 1** — run, pin, drift, re-pin — on top of a real answer.
4. **Then part 2**, the discovery route, unchanged and still gated on 1.

## Done when

A saved query can be run from a route that names only a project; a repo-authored `url_script` that has
not been trusted causes that route to refuse with a reason a panel can render, rather than prompting or
falling through to the `.env` layer; a trusted project resolves the same URL the pane would from the
main checkout; and the result carries per-column types drawn from the driver, with numbers as numbers
and timestamps as epoch milliseconds.

## What this deliberately does not decide

- **Which saved queries become collections** — all of them, or an opt-in per row. That is the
  enumeration question and belongs to the discovery route (`dynamic-collections.md` § 2).
- **Whether a pin may promote a text column to an enum.** A wizard question (`wizard.md`).
- **Anything about write-back.** A project-scoped connection is a read path here and nothing above
  changes if it stays one.

## Verify before building

- `resolveDbUrl`'s layer order and its trust call — this file's whole argument rests on `root` being a
  worktree in every layer but the last.
- `repoConfigTrustReview`'s `configAcks` query, and that it is still keyed by `projectId` rather than
  by task. Decision 2 is cheap only because it is.
- The pool map's lifecycle and `endDbPools`, so a project-keyed map is disposed the same way rather
  than leaking on quit.
- `PanelUnavailable`'s reason plumbing end to end, for the refuse-don't-prompt case.
- Whether `collection-sample` samples through the client's registry or the node's `CollectionRead`
  pointer — it decides which side sees a trust refusal first. **Known at time of writing** (cron
  phase 3): the sampler reads through the node's own registry (`server/collections/registry.ts §
  readCollection`, in-process dispatch), so the NODE sees the refusal — it surfaces as a
  `CollectionReadError`, the panel is skipped for that pass, and the run row says so ("1 skipped:
  database unavailable"). That is already the refuse-don't-prompt behaviour decision 2 requires,
  with no sampler change needed; re-verify only that the refusal's message names consent rather
  than reading as an outage.
