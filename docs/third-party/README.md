# The loaded-plugin migrations — review record and remaining work

Rollbar was the first plugin to move out of both compiled composition lists into a loaded package:
node and client bundles, native descriptor rows, a sandboxed detail frame, `id: "rollbar"` preserved
so provider ids, route paths, task links and stored connections carry over.

That move's review produced four findings, all resolved and their write-ups since retired: shipping,
seeding and updating bundled plugins (was a blocker); binding task origins and task-link connections
to the supplying plugin; scoping external-project mappings to caller-owned providers; and making the
reference frame use the shared styled UI kit.

The common rule is now explicit in code: plugin-supplied ids are claims; host-bound ownership is the
authority used before a claim can cross into core state.

Four more first-party packages have moved since: `model-providers` (which needed nothing new),
`linear` (which needed several things), `http` — the first with TABLES (§ below) — and `database`,
which needed a whole host-owned editor built for it (§ below). Every migration's outcome record has now
been retired the same way rollbar's was: the summary lives in this file, the per-finding detail in
`git log`, and the reasoning that must outlive the move sits beside the code it describes (each
plugin's `acorn-plugin.config.mjs` carries its permission rationale). The `document-over-frame`
contract that database's move built lives with its owner, `docs/plugins.md § Document surfaces`, with
the design record in `docs/future/monaco.md`.

## The Linear-migration review — closed

The linear move added eight host carriers, and a review record (`changes.md`, since retired) walked
them commit by commit for a second pair of eyes. The review ran, its verdict was that the carriers
were sound — each one follows the rollbar rule above, plugin ids are claims and the host binds the
authority — and it produced a punch list, all of which has landed:

- **The external-item store is provider-scoped at construction** (`integrations/itemStore.ts`). The
  ownership check at the ask used to gate only the argument; the store it returned could still name
  any provider per call. Now every query carries the provider it was built for, marker keys outside
  `provider:<id>:` are refused, and the fix covers all three doors onto the store
  (`providers.items()`, `ProviderResourceContext.items`, `ownedExternalItems`).
- **`ui.openUrl` is gesture-gated**: the broker honours it only while the frame holds focus and at
  most once per second, so background frame code cannot move the reader. This was the answer to
  "should a frame navigation be a declared permission" — a gate, not a grant.
- **The https-only policy has one spelling.** Two device-side sites (the command filter and the
  descriptor `openUrl` execution site in `chrome/`) re-checked with their own `startsWith` or not at
  all; both now call `isPluginOpenableUrl`, and the execution site re-checks because a roster row is
  wire input.
- **A slot badge's `onClick` takes the command verb set**, not the full one: its click has no row and
  no routed project, so `navigate`/`createTask` could only parse and then fail. The manifest refuses
  them now.
- **A plugin's declaration lives in its package** — `plugins/<id>/acorn-plugin.config.mjs` — instead
  of a table inside `build-plugin.mjs`, so the declared surface is diffed beside the code it
  describes. The builder reads it by id; the generated `acorn-plugin.json` is unchanged.
- **Over-declared grants were withdrawn**: rollbar's `secrets: true` had no call site and is `false`;
  `model-providers` only imported `@acorn/node-core` from tests and now declares it that way.
- **The reserved `x` route segment is pinned** by an arch rule (`tools/arch/boundaries.test.ts`), so
  the two deliberate spellings — client-core's constant and node-core's parse-time literal — fail a
  test instead of a user when they drift apart.

The durable knowledge from that record now lives with its owners: the carriers themselves in
`docs/plugins.md` and `docs/integrations.md`, the out-of-process cost of the callback-shaped provider
seams in `docs/security.md`. The linear outcome record itself has been retired, so its per-finding
detail is in `git log` (`c7f7911f` and the five commits after it) rather than in this folder.
One of its questions was answered by *keeping* the trade-off, now on the record here: the loaded
tier's confined `/p/:projectId/x/<plugin-id>/` URLs stay ugly on purpose, and the long-term answer to
the first-party/loaded asymmetry is to confine compiled plugins too, not to unconfine manifests.

## What came out right

Worth stating, because the hard parts are the ones that went well:

- **The dogfood test is green again.** `apps/node/test/integration/pluginLoader.test.ts` passes,
  and Rollbar is now the only Rollbar contribution rather than a disk copy shadowing a built-in.
  `pnpm test` is back to the three documented environmental failures (`serviceSpawn` ×2,
  `standaloneShutdown`); `pnpm lint` is green.
- **The fetch seam has a real caller** for the first time. `ctx.providers.integration(provider,
  createRollbarFetch(ctx.core.projects))` is the shape the whole loaded tier was built around, and
  it had none until now.
- **The permission set came out minimal, and the record of what was *not* needed is the valuable
  part**: no `tasks` facet, no events, no prefs, no `exec`, no project config, no project writes,
  and — notably — no task *write* scope on the frame, because creation and linking stay in the
  host-owned promotion flow. That is the evidence that the tier's grants are cut at roughly the
  right joints.
- **The descriptor trade-off was found honestly rather than worked around.** The rail lost
  Rollbar's connection/level/environment filters and its project picker, and the response was to
  move exploration into the frame and say so, not to grow the descriptor vocabulary until it
  became a UI framework. That restraint is what keeps the closed verb set closed.
- **The dual-action gap was closed in the host, not the manifest.** A row needed click-to-open and
  `+TASK`, and rather than adding plugin callbacks or a second action verb, the host now reads the
  row's existing `task` block as its promotion capability and draws the affordance itself. One
  fewer thing a plugin can get wrong.

## http has moved, and the storage path is proven

http is in neither compiled composition list; `id: "http"` is preserved so `/v2/p/http`, the pane's
persisted layout key and `<dataRoot>/plugins/http.sqlite` all carry over. It was chosen because it
owns tables, and that reason held: the manifest carrier, `ctx.storage.open()` and the loader's
confinement all existed, but **`build-plugin.mjs` never staged the migrations directory into the
package** — so the first plugin to declare one would have died on first open. Nine lines in the
builder, and `apps/node/test/integration/httpLoaded.test.ts` now covers the thing nothing had: a
migration arriving through an installer update, applied at the next boot, against a database with
real rows in it. Plus a broken chain failing contained, and uninstall-without-purge keeping the file.

Five findings, and only two are about the tier:

- **The frame SDK had four HTTP verbs and the protocol had five.** `AcornBridgeApi` was missing `put`,
  which the wire, the broker, the scope table and the host's fetch all carried from the start — so a
  plugin whose own routes take a full-replacement body could not call them from its own frame.
- **A frame has no `window.confirm`.** The iframe is sandboxed without `allow-modals`, so both of the
  panel's delete guards silently returned false. Two clicks replaced the dialog; deliberately not a new
  `ui.confirm` verb. `navigator.clipboard` moved to `bridge.ui.copy` for a sibling reason (an unfocused
  document cannot write the clipboard).
- **A saved request with an empty field could never be read back** — a live bug in the shipped compiled
  plugin, not a tier problem. `SecretService` treats an empty plaintext as "no usable credential" and
  throws; a GET with no body is the default shape of a new request. Found by a test that omitted a body,
  which every fixture in the package happened to fill in.
- **The agent-context redaction was leaking the query string.** The brief insisted the redaction be
  tested on the node, and it was right: header values, auth and body were withheld and the URL went
  through verbatim. Query keys stay, literal values go, `{{VAR}}` references survive as shape.
- **The permission sketch was wrong about `exec`.** Command-kind variables run `bash -lc`, so the owner
  is told "Run commands on the node". The call site is `node:child_process` rather than `ctx.core.proc`,
  which does not make it an over-declaration — contrast rollbar/linear's `secrets: false`, where the
  plugin genuinely never touches the host service.

The rail lost the same thing rollbar's did, on purpose: its Source *was* the whole panel, and a
descriptor source is a list of rows. A second project-scoped pane is what keeps a rail click working
outside a task, which is linear's answer applied again. The draft purge moved to the SHELL rather than
finding a new plugin hook, because the keys it removes were written by an older release of the app and a
frame's `localStorage` could never have reached them.

## Monaco does not fit in a frame, and that ends two migrations

The cheapest question in this folder has been answered, and it answered database and editor together.
A single-file Monaco frame built with the builder's own settings comes to **7.93 MiB against an 8.00 MiB
cap** — with a stub UI, no file tree, no tabs, no grid — and its four language-service workers
(14.58 MiB) **cannot be served at all**: an `app-plugin://<hash>` origin serves `/client.js` and the
host's `/ui.css` and nothing else, and the frame CSP has no `worker-src`, so `default-src 'none'` denies
workers including `blob:`.

Raising the cap does not fix the second half. This is the first surface class the sandbox demonstrably
does not serve — not "a pane that would feel slow", but one whose runtime requirements the single-file,
no-workers frame contract cannot express.

**The way out has since been decided and designed**: a host-owned document surface
(`docs/future/monaco.md`) — the app owns one editor and lends it to plugins through a vendor-neutral,
LSP-vocabulary contract, so no plugin ships its own 7.9 MiB copy and the sandbox widens for no one.
That document now carries the whole design: the composed-pane decision (region-addressed templates,
`document` and `document-over-frame`), the bridge document API, the flush-before-action guarantee, the
completions capability and its growth rule, and a build sequence. It is the record to hand a developer.

**That surface is now built, and database has moved over it** — see the section below. Editor is next
and is the only plugin still held by this finding. Its other two blockers were closed independently, and
folding find-in-files into the editor pane is done — none of the three ever depended on the tier move,
which is why they were worth doing without it:

- **`overlay` has a manifest form**, and it is a frame TARGET rather than a widened slot descriptor: a
  `slots` entry is data the host draws from a route, and a full-screen picker is a rectangle with the
  plugin's own UI in it. `{ "target": "overlay" }` plus an `openOverlay` verb, host-drawn backdrop and
  dismiss, `acorn.ui.close()` for the frame's own "picked, now go away", one open at a time, and a parse
  error for an overlay no action opens. This unblocks any plugin that wants a picker, not just editor.
- **`persistedState` will not get a manifest form**, and the reason is now on the record in
  `docs/plugins.md`: a slice is a codec bound to shell signals that the host hydrates before first paint
  and clears on scope eviction, none of which crosses a port. The tier's store is the frame's
  `state.get`/`state.set` in its own `plugin:<id>:*` namespace — the same prefs the node half's `prefs`
  facet reads. The cost is named rather than hidden: mount-time read instead of hydration, and the frame
  clears its own keys.
- **Find-in-files is a panel in the editor pane**, not a pane of its own, with `⌘⇧F` and a palette row
  opening the pane on it through a retained `editor:search` intent. The ripgrep route is untouched.

## database has moved, and it built the editor it moved over

The pane that could not be a frame is a frame — 156 KB of one, next to the 7.93 MiB a bundled Monaco
measured. It ships `document-over-frame`: the host draws the SQL editor and the drag handle, the plugin's
frame draws the button bar, the table sidebar, the result grid and its modals below. `⌘Enter` still runs
the query, which was the acceptance test the whole design set for itself.

The contract it built lives with its owner (`docs/plugins.md § Document surfaces`), the design record
is `docs/future/monaco.md`, and the per-finding detail is in `git log`, like every move before it. Five
findings, and three are about the tier:

- **A command still needs an action.** Step 4's "surface actions needed no new manifest field" was true
  of the CHORD and not of the command it names, so `surfaceAction` is a new verb on the closed set. It
  names the surface rather than deriving it from the keybinding, which keeps the command reachable from
  the palette too.
- **The chord cannot be resolved by the shell's dispatcher.** That one refuses scoped bindings while a
  typing target has focus, and Monaco's input area is one — so the host's own editor resolves it,
  against the same registry a frame's forwarded chords go through. The document is flushed before the
  command is posted, and that ordering is the contract rather than an implementation detail.
- **A frame cannot see core's model connections, and no scope should let it.** The Generate button needs
  to know whether a provider is connected; `/v2/core/integrations` has no bridge scope, and minting one
  would hand every installed plugin the whole connection roster — every provider kind, not just model
  ones — to serve one dropdown. The answer was the read half of a seam this plugin already had:
  `CoreServices.models.available(userId)` beside `generateText`, projected through the plugin's own
  route. Ids and labels cross the port; the key never leaves the node.
- **`secrets: false`, against the brief's sketch** — this plugin resolves its connection URL per connect
  and never persists it, so there is no credential at rest to hold. `exec: true` and `projects:config`
  do stay, and they are honest: it runs `bash -lc` on repo-configured scripts in two places.
- **A route capability died of irrelevance.** `DATABASE` existed to cross the old main/renderer boundary
  and this plugin has not had one since it became loopback HTTP; it is a closure argument now.

The editor's content became real state as a side effect, and it is an improvement: a document surface
needs a route that reads it and one that writes it, so the SQL is a per-task row and a half-written query
survives closing the pane. What the move deliberately did NOT solve is the result-grid measurement — rows
crossing a port as structured clones, at 50k of them — because nothing headless in this repo can take it.
It is on the verification list below.

## What is still owed, beyond these findings

- **model-providers has since moved**, and needed none of what follows. It is node-only with no client
  bundle, no routes, no storage and no `secrets` grant, so the move was a manifest row in
  `apps/node/scripts/build-plugin.mjs`, a line in the bundled roster, and four deletions. Nothing in
  it exercised a seam that was not already there, which is why it produced no findings of its own.
- **linear has since moved as well**, and unlike model-providers it produced findings — seven of them.
  Its outcome record has since been retired; the summary is here and the detail is in the commits. It was
  the first plugin to run a frame reference panel and declarative content links, and both were broken in
  ways nothing had noticed: a refPanel frame could neither draw its own drawer nor reach `onClose`, and
  the content-link grammar is exact-arity so one URL shape needs an entry per arity. It also found the
  one thing the brief was simply wrong about — it said "Blockers: none", and the workspace↔Linear-project
  picker turns out to have no home on this tier at all, because that write is unmappable on the bridge
  and absent from `CoreServices`.
- **Cross-plugin references are done**, and the design brief has been retired with the work. All three
  pieces landed: github no longer imports linear's `contract/` package (that directory no longer
  exists) and no longer depends on `@acorn/plugin-linear`; extraction is a host scanner over the
  contentLinks plugins already declare, enrichment is a `refResolvers` manifest carrier
  (`packages/protocol/src/refResolvers.ts`, linear declares the first one), and bare-id linkification
  is host-owned and learns its prefixes from confirmed refs. One piece remains **deliberately
  unbuilt**, kept here so it is not re-derived: cold-start bare refs (a `JIRA-42` with no confirming
  URL in context) need a bounded host-compiled token grammar — host-defined character-class atoms with
  length bounds, gated on a live connection and on confirmation through the provider's `refResolvers`
  route before anything linkifies. Build it only when a real plugin needs it. Plugin-supplied regexes
  were considered and rejected three ways at once: a manifest regex is a ReDoS surface the exact-arity
  grammar exists to close, it has no confirmation story when two providers' patterns collide, and it
  is a second pattern language beside the one contentLinks already teaches.
- **database has since moved** over the document surface it forced into existence (above). **editor has
  not**, and it is the last first-party plugin held by the Monaco finding: what it still needs is its own
  template — `frame-beside-document`, or host-drawn tabs fed by a document-list route — and the
  open-document verb ⌘P needs, both named in `docs/future/monaco.md § Sequence` step 7. Its brief is
  [editor.md](./editor.md). The rollbar brief itself was not restored; this file plus `plugins/rollbar/`
  is the reference now.
- **`agentContexts` has a manifest form** and now a real caller: http serves its options and capture
  from two of its own routes, with the redaction on the node and tested there.
  A descriptor names two routes in the plugin's own namespace — `options` (GET) and `capture` (POST) —
  and the host binds everything a plugin should not: `source` from the plugin id, the capture time,
  and the byte measurement the 512 KiB ceiling is checked against. `revision?()` deliberately has no
  form: it is synchronous and a descriptor answers across a fetch.
- **Editor has one blocker left**, and it is now a build rather than a question: its template
  (`frame-beside-document`, or host-drawn tabs fed by a document-list route) and the open-document verb
  ⌘P needs. The contract and the first composed consumer both exist; what editor wants from it does not
  yet. The `overlay` slot and the `persistedState` slice are resolved — see the section above and
  [editor.md](./editor.md).
- **Release validation**, as the moved doc already noted: a real-token soak and an installer-driven
  update. The bundled-plugin distribution work (rollbar's blocker finding) is a precondition for the
  second of those.

## Pick up work here

There are no unblocked migrations left in this folder, and the three items that were doable without one
— the `overlay` form, the `persistedState` decision and the find-in-files fold — have landed. What
remains needs either a person in front of the running app or build work on a decided design:

- **The editor plugin's move** (`docs/future/monaco.md § Sequence`, step 7) — the last one held by the
  Monaco finding, and the only step of that sequence left. Steps 1–6 have shipped: the consolidation,
  the language-id vocabulary, the region-addressed contract, `document-over-frame`, the bridge document
  API and completions. What step 7 has to settle is editor's own template shape and the open-document
  verb ⌘P needs; the brief is [editor.md](./editor.md).
- **A live verification pass**, and it now covers three migrations plus the editor-pane fold (list at the
  bottom of this file). `pnpm test` cannot render a Solid component in this repo, so every frame surface
  these migrations added is read-and-reasoned rather than watched.
- **The first consumer of the `overlay` target.** The carrier exists and is tested at the manifest and
  broker boundaries, but no loaded plugin declares one yet — the seam is unexercised end to end, which
  this folder's own rule says is where seams rot. Editor's ⌘P is the intended first consumer and it
  waits on the document surface; a smaller picker in any loaded plugin would exercise it sooner.
- **Release validation**: a real-token soak and an installer-driven update.

## Known issues and open decisions the review left standing

Carried forward from the retired review record so they are not lost with it. None blocks the
remaining migrations; each is a decision or fix someone should own deliberately. The four that had
task files — the two dead-click gates, the missing source empty state and the `build:plugin` dev-package
trap — are fixed and gone from this list. So is "multiple bundled plugins raise multiple boot trust
prompts": a development build now acknowledges the bundled first-party roster on the same terms a
packaged build does, so there are no boot prompts to stack and the specs that answered them do not have
to (`docs/plugins.md` § The dev loop).

- **A frame surface has no `when` predicate**, so every provider pane appears on every task with an
  empty state. Deliberate for now (an empty state is more discoverable than a pane that silently is
  not there); a `when` would need a descriptor vocabulary for task predicates.
- **`broker.fetch` throwing `Unknown node` is the only connection failure not modelled as a
  connection state**; it prints a stack instead of degrading into the offline/stale vocabulary the UI
  speaks. Left alone during the migration because fixing it would have hidden the local-node
  singleton bug rather than surfacing it.
- **The local node's label resets to "This computer" after an identity change** (a replaced data
  root). A rename arguably belongs to the machine, not the identity.
- **`pullsBatch` swallows GitHub server errors** — partial alias failures mirror the PRs that did
  resolve, so the UI keeps previously-mirrored rows with no visible signal that the pass failed.
- **`refs`/`onSelectTarget` on `RefPanelProps` have zero callers** of any kind and are carried dead;
  delete or justify.
- **Verification debt** for everything only a running app can prove, now across three migrations. From
  database, which is the longest of the three because a composed pane is two realms side by side: the
  splitter dragging and the editor holding its height; ⌘Enter with focus in the editor running the query
  against the just-typed text (the acceptance test, and the one thing nothing headless can prove);
  Execute and ⌘Enter agreeing; the saved-query picker and Generate writing INTO the host's editor;
  table/column completions popping on `.` against a real database, and going stale-then-fresh after a
  DDL statement; the two modals covering only the bottom region and being usable there anyway; the
  scratch document surviving a pane close and a reopen; the focus seam between the editor and the grid;
  the Generate button appearing only with a model connection; and **the result-grid measurement** — an
  ad-hoc `SELECT` with no `LIMIT` against a real table, which is the one open question from the brief.
  From
  linear: the reference panel inside a PR, bare-id anchors, the ticket chips, the project-scoped issue
  view, the rail's empty state, `ui.openUrl` on screen, the project-mapping picker, both appearance
  axes, a real Linear token. From http (this list is now the source of truth; its outcome record is
  retired): the three frame surfaces, the two-click delete guards, `bridge.ui.copy`, the
  project-scoped pane opening from a rail click, the settings project picker, the composer's
  agent-context option list, and the context routes' positive path live — the integration test covers
  it but the dev data root has no tasks, and both routes are task-scoped. What http *did* verify
  headless, for the record: the built package boots on the standalone node with all contributions
  parsed, a bodiless GET saves and reads back (the empty-field secrets fix), the rail row renders from
  its route, and SIGTERM drains the plugin's WAL handle before the data-root lock. From the editor-pane
  fold, which is first-party and so has no frame at all: the sidebar's Files/Search toggle at 240px,
  `⌘⇧F` from outside the pane opening it with the box focused, the query surviving a flip to Files and
  back, a double-clicked hit revealing in Monaco, and "Reveal active file in editor tree" flipping the
  sidebar back. The route and its two ripgrep gotchas are covered by the unchanged tests.
