# Plugin events: what each plugin should announce

Part of [docs/future/events/](./README.md). Core events ([core-events.md](./core-events.md)) cover
transitions only core can see. This file is the other tier of the catalogue: transitions a *plugin*
owns, published on the `plugin:<id>:<verb>` channel that already exists
(`protocol/src/pluginState.ts`), so that other plugins can eventually listen
([subscriptions.md](./subscriptions.md)).

**Status: the producers ship (2026-08-28).** Every verb below except preview's two is emitted from
the site named, through the `ctx.events.send` each plugin already had; nothing new was built. The
deviations from the text below, so nobody re-derives them:

- **`items-changed` is sent by core, once per refresh, for every provider.** The write it announces
  is core's (`node-core/src/server/integrations/resourceRuntime.ts`, after a successful
  `resource.refresh`), so the emit lives there rather than once per plugin, and a future provider gets
  the verb for free. linear's ref-resolution batch writes past that runtime and says so itself
  (`plugins/linear/src/server/routes/linear.ts`).
- **`checks-changed` fires only when a check row actually differs.** `mirrorPr` compares the checks
  table before and after the replace and reports it; `pr-synced` goes out on every sync regardless.
- **browser's `capture-created` carries no `url`.** The capture store never sees one.
- **notes seeding announces once**, through a second silent `NotesStore` over the same directory.
- **preview is not started.** Its prerequisite (moving the URL ladder to the node) is real work and
  stands on its own.
- **No consumer has moved yet.** The workflows→github checks poll is still a poll; replacing it is
  [subscriptions.md](./subscriptions.md) work, since workflows would be hearing another plugin's
  channel. The context plugin's block revision likewise still bumps by hand.

Two facts framed the design. First, the namespace was completely unused: all four loaded plugins
declared `permissions.events: []`, no frame in the tree called `acorn.on`, and no node half sent a
verb. Second, a plugin publishing to *its own* frames works with no new machinery — the broker, the
allowlist-by-shape, and the coalesced client routing all exist
(`client-core/src/plugins/pluginChannel.ts`). So producers could start emitting before cross-plugin
subscription is designed, and the payloads get real exercise.

The admission rule from the [README](./README.md) applies per verb, with test 1 inverted: the
emitting plugin must be the only honest observer of the transition. Payloads carry state, not
deltas, so a missed frame self-heals by re-reading the plugin's own routes.

## The pattern the survey found

Six of seven integration-shaped plugins own the same transition and none can say it: **a node-side
mirror write completed and the external data changed.** github's PR mirror
(`server/routes/prMirror.ts:116-218`), linear's issue cache (`server/provider.ts:219`), rollbar's
item and occurrence caches (`server/provider.ts:283`, `occurrenceResources.ts:63`) all converge on a
write with a `fetchedAt` stamp — exactly the state-carrying, self-healing shape admission test 3
asks for. One verb per plugin, `items-changed`, covers the whole family, and the consumers are the
same three plugins every time: notifications, dashboards, and anything doing standup or worklog
assembly.

## Per plugin

### github

- **`checks-changed`** `{ repoOwner, repoName, pullNumber, headSha }` — emitted where the checks
  table is replaced (`prMirror.ts:204-205`). The single highest-value plugin event in the tree: the
  one live cross-plugin dependency today is workflows polling `GITHUB_MIRROR.failingChecks`
  (`apps/node/src/server/pluginDeps.ts:52`), and a green-to-red flip is invisible until asked for.
  This verb replaces that poll and is the acceptance test for the whole design.
- **`pr-synced`** `{ repoOwner, repoName, pullNumber, headSha }` — the composite mirror completing
  (`prMirror.ts:116`). New review, new comments, new commits, all reduced to "re-read this PR".
- **`pulls-changed`** `{ repoOwner, repoName }` — the open-list refresh (`pullRefresh.ts:101-129`),
  which already knows which numbers are new versus retained. A notification plugin's "new PR for a
  repo you track".
- PR adoption by a task is deliberately *not* here — it goes through `core.tasks.adoptPullNumbers`
  and belongs to core's task changed event.
- Owner/name in payloads follow the standing rule: compare case-insensitively.

### linear

- **`items-changed`** `{ connectionId }` — the issue mirror writes (`provider.ts:219`, and the
  ref-resolution batch at `routes/linear.ts:294`). "A new Linear issue" fails the *core* admission
  test by design; it is precisely what the plugin's own channel is for. An issue moving to Done or
  In Review is derivable by the consumer from the re-read, which keeps the verb count at one.

### rollbar

- **`items-changed`** `{ connectionId }` — the list mirror (`provider.ts:283-289`) and occurrence
  cache (`occurrenceResources.ts:63`). The payload a consumer re-reads already carries
  `totalOccurrences` and `lastOccurrenceAt`, so "the item linked to my task started erroring again"
  is a join the consumer can do — which matters, because that join against `taskTracksRef` is the
  single best notification acorn could offer and it needs no extra verb.

### workflows

- **`run-changed`** `{ runId, status }` — run started (`workflowRunner.ts:189`) and run reaching a
  terminal state through the already-guarded `finishRun` (`:504-512`). CI-style consumers,
  notification plugins, and cost tracking all key on the same pair.
- **Gate opened** is already served: it goes to the notification bell through `workflow:notice`.
  Whether it additionally becomes a verb is a consumer question to defer, not a gap.
- Per-step status writes and the step event stream stay internal ([refused.md](./refused.md)).

### agents

- **`usage-refreshed`** `{ }` — the snapshot build in `main/usage/service.ts:94`. The client polls
  the route on an interval today (`usageStore.ts:56`); a cost dashboard should not have to run a
  second copy of the same poll. Session lifecycle itself is a core event
  ([core-events.md](./core-events.md) § Agent session state) because its consumers are blocked
  loaded plugins, not the agents plugin's own frames.

### terminal

Nothing on its own channel. Its two event-shaped transitions — worktree lifecycle and run-target
state — are core events, because terminal holds them as core's hook consumer and capability
provider, not as their owner. Session spawn/exit/idle remain the content-free `term:status` ping
they are today.

### changes

Nothing on its own channel. Commit and push feed core's HEAD moved event through the core seam;
stage/unstage/discard churn and review-note CRUD stay internal.

### docker

- **`task-teardown`** `{ taskId }` — containers for a task torn down during archive
  (`dockerBridge.ts:125`); a port manager or preview holding state keyed to those containers wants
  it. Compose up/down was considered and leans no: another plugin can ask `docker compose ps`
  itself, so it fails test 1. The daemon-event `docker:changed` ping stays internal — it fires on
  container health checks, which is machine-scale.

### preview

- **`url-changed`** `{ taskId, url, source: 'run-target' | 'config' | 'script' | 'recipe' }` — the
  most requested cross-plugin fact in the whole survey (Lighthouse, accessibility audit, visual
  regression, link checking all start from it), and the clearest case of the delivery rule
  disqualifying an implementation: the URL is currently derived per-render in the renderer
  (`PreviewTaskPane.tsx:36-48`) on a desktop-only path. Three of its four branches are already
  computed node-side (`harness.ts:57`, `worktree.ts:129-133`), so the honest version moves the
  resolution ladder to the node and emits from there. That move is a prerequisite, not a nicety.
- **`navigated`** `{ taskId, url }` — human-scale, and the frame tier already has
  `webview:navigated` as the precedent for the same shape. Lower priority than `url-changed`.

### browser

- **`capture-created`** `{ taskId, captureId, url }` — a screenshot row landing
  (`server/captures.ts:21`), with a stable read route already serving the bytes. Visual-regression
  and run-history consumers. Per-step navigate/click/fill and console lines stay refused — they are
  the agent's inner loop.

### database

- **`saved-queries-changed`** `{ projectId }` — the upsert and delete in
  `routes/database.ts:203,230`. Project-scoped, payload-free, self-healing.
- **`schema-changed`** `{ taskId }` — inferrable exactly where a non-DML statement drops the cached
  catalog (`main/database.ts:273`). A migration tracker, ERD pane, or type generator wants it;
  today a migration running is invisible. Individual query runs stay refused: machine-scale, and
  the SQL and results are the user's private data.

### http

- **`saved-requests-changed`** `{ projectId }` — create/update/delete in
  `routes/http.ts:277,308,341`. Same shape and argument as database's saved queries.
- **Request sent** was considered and refused as a broadcast. A single manual send is human-scale,
  but the response can contain resolved secrets — `send.ts` redacts on the way to its caller, and a
  broadcast would need the same redaction to be safe, which is a standing reason to keep it
  plugin-local. If a request-history consumer ever materialises, the reduced shape
  `{ projectId, method, url, status, durationMs }` is the most that should cross.

### notes

- **`notes-changed`** `{ scope, taskId? }` — the store's create/write/setIncluded/remove
  (`main/notes.ts:134,153,171,214`), plus one event (not N) when task seeding completes
  (`seedTaskNotes.ts:60`). The standing consumer is real and broken today: the context plugin's
  block revision is bumped by hand from its own pane, so an agent-written note never bumps it, and a
  second client's notes are stale. This verb is to notes what task changed is to core — a defect
  fix wearing an event's name.

### memory

- **`proposals-changed`** `{ taskId? }` — proposal created (`memoryProposals.ts:69`) and resolved
  (`:105`). The create half already half-exists as a `workflow:notice` with a title string; the verb
  carries re-readable state instead. An accepted proposal writes a file into the worktree, which
  changes and context both care about.
- Index reconciliation and access-count bumps stay internal.

### context, editor, onboarding, model-providers, the agent profiles

Nothing, and each absence is informative. **context** is a client-only projection over other
plugins' data — it is the consumer this file keeps naming, not a producer; its one candidate
(`context.synced`) has no consumer yet. **editor** is a pure request/response bridge whose only
mutation is the file write, and "file saved" is refused by name — editor is the standing proof that
a plugin with no events does not suffer for it. **onboarding**'s needs are all inbound (project
changed, connection changed); its `completed` pref write has no consumer. **model-providers** is
registration-only; the credential transitions it surfaces belong to core's connection changed.
The **profiles** are declarative descriptors with no state at all.
