# Phase 4 — what shipped, what it caught, and where it diverges

Phase 4 (plan.md § "Phase 4 — fleet product surfaces") is **complete against its exit criteria**. Read
[phase3-notes.md](./phase3-notes.md) first if you have not; two of its open items are closed here, and its
"Corrections after review" preamble is the model this file tries to follow — say what is true, not what
sounded good while writing it.

## Status against the exit criteria

plan.md names five two-node scenarios plus a remote-task criterion. All are in
`apps/desktop/e2e/twoNode.spec.ts` (12/12 e2e green):

| Exit criterion | Where | Notes |
| --- | --- | --- |
| same-UUID collision across nodes | `drives the bundled node and a second node concurrently` | Phase 1's test, unchanged |
| node offline — stale render | `renders the fleet with one node down` | The card renders from that node's OWN cache with an `offline` badge. See "What the offline test does NOT assert" |
| node offline — failed mutation kept as draft | `packages/client-core/src/apiClient.test.ts` + PullDetail's `runThenClear` | Deliberately not e2e; reasons below |
| revocation mid-session | `reports a node as revoked when it revokes this client mid-session` | Revoked FROM the node by the test process, so the client is not agreeing with itself |
| aggregated surfaces with one node down | same test as "node offline" | Both cards render; the healthy node is unaffected |
| a remote task's terminal/agent/preview over the LAN | `runs a terminal and opens a preview tunnel on a remote task` | A real PTY on node B, and bytes through the tunnel |

Three items earlier phases scheduled into this one are also done: the client-side device-prefs tier
(data.md § Client cache), freshness beyond Phase 1's two render sites, and word-fingerprint rendering
(phase1-notes.md § Transport). So is Phase 3's outstanding pair: the client-side disabled-plugin cycling
test, and the two client plugins doing I/O in a synchronous `init`.

## Seven bugs the phase's own tests found, five of them pre-existing

Listed first because they are the useful part. Three were only findable by asserting something nobody had
asserted before, which is the argument for the e2e existing at all. An adversarial review then found
fourteen more — see "The adversarial review" below.

**1. Inbound WebSocket frames had their nodeId discarded.** `wsClient.ts` dispatched every frame main pushed,
and its subscriber maps are keyed on session / container / exec ids alone. So node B's `term:out` for a
colliding session id fed node A's xterm, and its `agent:*` frames mutated the store the Agent Center renders
— one directory from the guard in `wsHub.ts` that refuses exactly this server-side. Pre-existing since Phase 1.

**2. `everOnline` was one boolean for the whole fleet.** Whichever node connected first set it, so a second
node's very FIRST connect read as a reconnect: it re-attached every one of the ACTIVE node's PTY
subscriptions and told the shell to refetch. Pre-existing since Phase 1, unreachable with one node.

**3. Module-level feature state survived a node switch.** The per-node QueryClient partition covers cached
queries; the managed-agent roster, terminal sessions and the notice ring are module signals and sat outside
it. Terminal sessions were the worst: both archive/quit concerns counted another machine's running agents
against this node's tasks, up to blocking an archive with "2 active sessions" that belonged elsewhere.

**4. An unclaimed HTTP upgrade leaked its socket forever.** Node destroys an upgrade socket only while there
are NO `'upgrade'` listeners; `wsHub` added one in Phase 1, so from then on an upgrade to any other path was
answered by nobody and stayed open — one socket per request, unbounded, and it made `server.close()` hang
because an upgraded socket is no longer in the list `closeAllConnections` reaps. Found by a tunnel test that
hung in `afterEach`. Fixed with `main/upgradeClaim.ts`: handlers claim synchronously (before their async
auth, so a later listener can distinguish "mine" from "not answered yet") and a sweeper registered last
destroys the rest.

**5. PullDetail wiped the user's text when a mutation failed.** `run()` reports a failure and then RESOLVES,
and both text submitters were `run(...).then(() => setBody(''))` — so the `.then` fired on failure too. A
comment or review rejected by GitHub, or submitted against an offline node, showed the error and cleared
what had been typed. The drafts are persisted per PR, so the loss survived a reload. This is precisely the
behaviour ui.md § Connection and staleness vocabulary requires ("keeps the user's input as a draft"), which
is how it came to light.

Plus two of my own, both caught by the two-node e2e and both worth recording because the failure mode was
indirect:

**6. The tunnel's Host guard rejected everything.** `attachTunnel(server, { ...wsDeps, declaredPorts })`
COPIED `allowedHost` while it was still `''` — the port is ephemeral, so it is filled in from the listening
callback. The tunnel then compared every upgrade's Host against the empty string. It surfaced as a bare 403
with nothing logged on the node. Both handlers share ONE mutable deps object now, which is the shape
`wsHub`'s own comment already described and which I failed to read.

**7. A fan-out wrote the wrong SHAPE into a shared query key.** Fleet home fetched
`(await readJson<Task[]>(...)).length` under `tasksKey`, and `fetchQuery` writes through by design — so a
NUMBER landed where the rail, the palette and the workspace-restore effect all expect `Task[]`. They began
throwing `.find is not a function`, the uncaught render error wedged Solid's flush queue, and the visible
symptom was a node badge that never updated. Nothing but a rendered two-node assertion could have found
this. The rule is now stated at length in `node/fanout.ts`: share a key only when you share the value's
shape.

## What the offline test does NOT assert, and why

Two deliberate omissions, both corrections to this test's first version.

**No `.fleet-banner`.** `createFleetQuery` falls back to the dead node's own QueryClient, which is warm from
the render before it died — so the honest result is a STALE ROW, and the banner is reserved for a node that
has never answered. Asserting the banner would have been asserting the weaker behaviour. The banner path is
covered with an empty cache in `node/fanout.test.ts`.

**No failed-mutation-keeps-the-draft.** That lives inside `apiClient.send`, and reaching it from Playwright
means either importing a renderer module by specifier (the bundle does not expose them at runtime — the
first attempt returned "Failed to fetch", which is the `connect-src 'self'` CSP working as designed) or
driving a whole compose form. It is covered directly, with non-vacuity checks, in `apiClient.test.ts`.

**The kill signal is SIGKILL, and the two rejected alternatives are findings:**

- **SIGSTOP is invisible to the client.** A stopped process holds its sockets open without answering.
  Nothing closes, so the broker attempts no reconnect and the node reads `online` indefinitely: **there is
  no application-level heartbeat on the events socket.** A node that has hung, or a laptop that slept
  without dropping its TCP connections, is not detected. Not fixed here — a WS ping/pong watchdog is a
  transport change with its own failure modes, and it belongs with protocol.md's stream work rather than
  bolted on to close a test.
- **SIGTERM was too slow.** `standalone.ts`'s drain (plugins, SQLite, the root lock) ran long enough that
  the socket outlived a 30-second poll. Worth knowing before relying on a graceful stop in an operational
  script.

## Deliberate divergences

**Tunnels are a dedicated `/v2/tunnel` upgrade, one WebSocket per TCP connection.** protocol.md § Streams
designs them as a third `kind: "stream"` frame flavour on the events socket with a credit-based
flow-control layer. Per-connection is *less* code, not a shortcut: `net` and `ws` supply the framing and the
backpressure a shared pipe would need window accounting and head-of-line handling to reproduce, and a
browser opens many sockets to a dev server (assets, XHR, the HMR socket) that must not block each other. The
events socket also still carries the flat V1 frame vocabulary (phase1-notes.md), which has no `kind`
discriminator to hang a tunnel frame off.

**"Search with per-node fan-out" is the palette's task and workspace rows.** `plugins/editor`'s
find-in-files is worktree-scoped — one task, one node — so fanning it out is meaningless.

**The aggregated Agent Center is live for the active node and POLLED for the rest.** The managed-session
store is keyed by session id alone, so making every node live means keying it by `(nodeId, sessionId)` and
opening a socket per node. The scope toggle appears only with more than one node paired.

**A plugin's enabled/disabled state is the node's.** So a client-only plugin (changes, context, editor,
onboarding — none has a node half) is not togglable: it contributes presentation over core's data, and there
is nothing on a node to turn off. `memory` and `notes` became `required` on the client to match the node,
because with the node as the source of truth a client-side disable of either was unreachable state.

**Settings → Plugins is per node, and the list lives in the node's data root.** Not in the desktop app's
`fleet.json`: a remote node is started by launchd, systemd or a shell, and nothing about that boot consults
a client's fleet file, so the setting would silently do nothing for exactly the deployment the fleet exists
to serve. `disabled-plugins.json`, mode 0600, atomic rename, beside `internal-token` and `active-identity`.
A plain file rather than a settings row because the plugin host runs before any route can answer and the
list decides which databases get opened at all.

**Restart is offered for the local node only.** A remote one shows "restart required", which is honest
rather than a button that cannot work. `restartLocalNode` does NOT route through `recover()`: spending one of
the five crashes in the ten-minute budget on a deliberate restart would mean a few plugin toggles could trip
the recovery screen.

**The attention inbox is a section in the notice bell, not its own surface.** The two answer adjacent
questions and the popover already has the row chrome, the target-handler table and the task navigation both
need. The types stay separate, and that distinction decides everything else: a notice is an EVENT that
happened (client-local, dismissible, gone when the 50-entry ring rolls over); an attention item is a STATE on
a node that persists until something changes there, so it is fetched, has no `read` flag, and correctly comes
back after a dismiss.

**Notices are node-STAMPED, not cleared on a switch.** They are persisted and rehydrated once at boot, so
clearing would empty the bell permanently after the first node switch. Live rosters are the opposite case and
ARE cleared: they refetch within a tick, so a stale roster is worse than an empty one.

**Word fingerprints are rendered client-side; the node still prints hex.** Six words from a frozen 256-entry
list is 48 bits — the same strength as comparing twelve hex characters, and the reason not to use more is
that a person compares a short phrase reliably and a long one carelessly. The raw hex is still shown beside
it, because the phrase is the check a person can make and the hex is the value a person can paste and diff.
Teaching the node the word list would let the two ends disagree if either shipped a changed list, with no
upside.

**No per-pane `freshness` hook.** A pane's own query status is only knowable reactively; `getQueryState` is a
snapshot, so a `freshness(task)` field returning one would render a badge that never updates — worse than no
badge. What `TaskPaneHost` renders is the NODE's state, which is the reactive half of ui.md's vocabulary and
reaches all thirteen panes through one edit, because `.pane-slot-actions` is the only chrome every pane has.

**Presentation prefs moved to the device; per-machine behaviour did not.** Agent tool permissions govern what
an agent running THERE may do, so they stay on the node — still pinned to the home node, and still for
Phase 1's reason: a single flat record has no room to say "per node", so one node has to win. Naming that
compromise honestly is the change; the mechanism is unchanged.

## What is covered by tests

| Claim | Where |
| --- | --- |
| every non-required CLIENT plugin can be disabled with every other plugin's contributions byte-identical and in order | `apps/desktop/test/client/clientPluginDisable.test.ts` — a LITERAL ledger, because a derived one goes empty when the host's disabled check is neutered and the equality then passes vacuously (measured: the only failing line was the host's own self-report, Phase 3's exact trap). Verified against four mutations |
| no client plugin performs browser I/O during `init` | same file — `activate` stripped and `localStorage`/`fetch` deleted, so a third plugin joining the two fixed here throws |
| `activate` runs after every `init`, in order, never for a disabled plugin | `packages/client-core/src/registries/plugin.test.ts` (2 mutations fail) |
| the per-node disabled list round-trips privately and reads a corrupt file as empty | `packages/node-core/src/main/disabledPlugins.test.ts` |
| `GET|PUT /v2/core/plugins` reports running and pending separately and refuses unknown and `required` names | `packages/node-core/src/server/routes/plugins.test.ts` |
| a task-scoped agent can neither read nor write that route, through the REAL `createApp()` | `apps/node/test/integration/internalPrincipal.test.ts` (fails 503→403 with both mounts removed) |
| the tunnel closes a live pipe on revocation (callback) and on the periodic sweep (`isActive` alone) | `packages/node-core/src/main/tunnel.test.ts` (1 fails per guard removed) |
| the port allowlist against a REAL database: `previewMode` port/url/script, every run target's url, an unknown task, a throwing bridge | `packages/node-core/src/main/tunnelPorts.integration.test.ts` (3 mutations fail) |
| a remote loopback URL that cannot be tunnelled resolves to NULL, never to the client's own localhost | `packages/client-core/src/node/tunnelUrl.test.ts` |
| the host's roster covers skipped plugins and honours the `required` exemption | `apps/node/test/integration/pluginDisable.test.ts` (2 mutations fail) |
| frames from a non-active node reach no subscriber; reconnect bookkeeping is per node | `packages/client-core/src/wsClient.test.ts` (3 guards, each fails when removed) |
| notices are stamped and filtered per node; "mark all read" only marks what is shown | `packages/client-core/src/notifications/notifications.test.ts` (2 mutations fail) |
| the live rosters clear on a node switch and NOT on an unrelated node removal | `apps/desktop/src/app/client/scopedEviction.test.ts` |
| fan-out: per-node deadline, cache fallback marked stale/offline, partial results as data, fleet order, per-node cache | `packages/client-core/src/node/fanout.test.ts` (4 mutations fail) |
| `when` gates a source independently of `providerId`, and is AND-ed with it | `packages/client-core/src/tabs/sources.test.ts` |
| attention and node-stat registries sort on the declared order; severity beats age | `registries/attention.test.ts`, `registries/nodeStats.test.ts` |
| selecting a workspace switches the node BEFORE navigating, and not at all for an empty one | `packages/client-core/src/workspaces/fleetWorkspaces.test.ts` (fails if the two lines are swapped) |
| a mutation to an offline/revoked node fails fast with `node_offline`; a READ is still attempted; `degraded` still writes | `packages/client-core/src/apiClient.test.ts` (3 mutations fail) |
| the tunnel refuses an unauthenticated upgrade, a foreign Host, an undeclared port, and a foreign task; 502 for a dead port; claims only its own path | `packages/node-core/src/main/tunnel.test.ts` (4 mutations fail; the path-claim case needed two rewrites before it could fail — see the comment there) |
| which URLs imply a tunnellable port, including the `localhost@evil.test` userinfo disguise | `packages/node-core/src/main/tunnelPorts.test.ts` |
| a loopback URL is rewritten only for a remote node, and a tunnel failure falls back to the original | `packages/client-core/src/node/tunnelUrl.test.ts` |
| the standalone entry performs the same three app-layer wirings as the supervised one, and each populates what it claims | `apps/node/test/integration/standaloneParity.test.ts` — asserted against BOTH roots, with comments STRIPPED before scanning (commenting a call out satisfied the first version) |
| the device/node pref split, the one-time seed, and device-wins merge | `packages/client-core/src/persistence/devicePrefs.test.ts` |
| a storage key carries the node; another node's key is REFUSED; a pre-Phase-4 key is still accepted; a scope id containing a slash round-trips | `packages/client-core/src/persistence/scopedKeys.test.ts` |
| the word list is 256 entries; the phrase ignores separators and case; it is null rather than partial | `packages/client-core/src/node/fingerprintWords.test.ts` |
| the plugin toggle recomputes the whole list, is idempotent, and never carries a required plugin through | `packages/client-core/src/settings/pluginToggle.test.ts` |

Also fixed: a 1-in-4096 flake in `secretBox.test.ts` that had been blamed on the suite's load sensitivity —
the "tampered" ciphertext overwrote the last two base64url characters with a fixed `xy`, which collides with
the original about once in 4096 seals. Flipping the last character instead would have been worse, because the
tag's final base64url character is mostly padding bits a lenient decoder discards.

`pnpm lint` 26/26, `pnpm test` 26/26, `node scripts/db.mjs check` 9/9 chains, `pnpm --filter
@acorn/arch-tests test` 14/14 (plugin→plugin still `[]`), e2e 12/12.

## The adversarial review, and the eight further bugs it found

An adversarial security/correctness pass was run over the finished phase. It produced 39 findings; the ones
that were real are fixed in the commit after this document's first version, and the ones that were not are
recorded here so nobody re-litigates them.

**Security, all fixed:**

1. **A live tunnel survived device revocation.** protocol.md § Pairing promises "open sockets are closed",
   and `wsHub` has honoured both the immediate callback and the 60s `isActive` sweep since Phase 1. The
   tunnel honoured NEITHER — it never recorded a deviceId. So a stolen laptop's established pipe kept
   reaching the dev server after the owner revoked it; refusing a *new* upgrade is the half that stops
   mattering once one is open. Both halves now, with a test per half (the callback case leaves `isActive`
   true so the sweep cannot explain it — without that it passed with the callback deleted).
2. **`previewMode: 'url'` was not a declared port, and the client fell back to loading its OWN localhost.**
   The nastier half was the fallback: `tunnelUrl` returned the untunnellable URL, so a remote task configured
   `http://localhost:8025` rendered whatever was on the owner's 8025 while the pane claimed to show the
   remote preview. `'url'` is now a source and the client returns **null** instead of the original.
3. **Only the DEFAULT run target's url was declared.** A task with an app on 3000 and a Storybook on 6006
   could only tunnel to whichever was marked default — and a layout recipe's `browser` url points at any of
   them, which is the *first* branch of the pane's resolution. Every target's fixed url now counts.
4. **`PreviewTunnels` resolved the node once**, so after a restart every later connection dialled the old
   ephemeral port with the old token — while `bootstrap.ts` carried a comment claiming the opposite. It
   re-resolves per connection, and `restartLocalNode`/`adoptLocalNode` close the node's tunnels.
5. **`refuse()` wrote to a socket whose peer may be gone**, and **the connect handoff dropped its error
   listener** — both an unhandled `'error'`, i.e. an uncaughtException in the service. Hardened. **Neither is
   test-proven**: with the guard removed and the resolver stalled 120ms, a flood of connect-then-RST upgrades
   still did not reproduce the crash on macOS. The tests assert the flood does no harm; the guards are
   precautionary and labelled as such in the test.
6. **`open()` was not idempotent under concurrency** (two overlapping calls leaked an unreapable listener),
   **`pending` was an unbounded buffer** in main before the ws opened, **a dead listener stayed in the map**,
   and **`key()`'s `|` delimiter was injectable** through a `taskId` the IPC schema does not charset-check.
   All fixed; the buffer is gone entirely in favour of `socket.pause()`.
7. **`requireDevice` was mounted on `/v2/core/plugins` but not `/v2/core/plugins/*`.** Probed: no live
   bypass, because the router has only `GET|PUT /`. Both forms now, like every sibling.
8. **A nodeId was written RAW into every storage key.** It arrives over the wire from `GET /v2/node` with no
   UUID validation, so a node reporting `a/b` made its keys unrecoverable and one reporting `''` made them
   indistinguishable from pre-Phase-4 unqualified keys — i.e. able to read another node's layouts. Encoded.

**Correctness, all fixed:**

9. **`applyNodePlugins` never ran on a node switch.** `index.tsx` mounts App inside a `<Show keyed>` on the
   active node, so `on(activeNodeId, …, { defer: true })` recorded the new node in a freshly-created effect
   and the dying one was disposed before user effects flushed. Every node after the first kept the previous
   node's contributions — the client half of Settings → Plugins did nothing. A plain mount effect is correct
   *because* of the remount, and `applyNodePlugins` is idempotent per node.
10. **A node switch copied the previous node's layouts into the new node's namespace.** `storageKeyFor` reads
    the active node at WRITE time while the stores behind the scoped slices are keyed by bare ids and survive
    the remount — so the persistence pass wrote node A's pane layouts, open files, PR filters and context
    selections under node B's key, and overwrote B's own for any id the two shared. Without this fix the
    qualification made things *worse* than no qualification. `recipeBrowserUrls` was the one with teeth
    beyond lost UI state: it is the first branch of the preview URL, so node A's value chose which port the
    client asked node B to tunnel to.
11. **`restartRequired` was permanently true** whenever the start config disabled a plugin without writing
    the file (`dev:node`, an integration harness): the bridge reported the file alone. It reports the
    effective union now.
12. **Restart raced crash recovery.** No `recovering` guard, so a click during backoff succeeded and then
    `recover()`'s own `startService()` threw "already started", whose catch called `service.stop()` and
    **killed the working node** before spending another crash from the budget. Guarded, and a failed restart
    now reaches `recover()` instead of leaving the app with no node until relaunch.
13. **`markTaskRead` was not node-filtered** while `markAllRead` and `unreadForTask` were, so viewing a task
    marked another node's notice about the same id read. **`pushNotice`'s stamp was overridable** by a caller
    passing `nodeId: undefined`, which reads as the home node's — i.e. someone else's.
14. **Settings → Plugins wrote a non-active node's list into the ambient signal** that feeds the client
    plugin host. Publishing is now gated on the target being the active node.

**Test quality, all fixed:**

15. **The `/v2/core/plugins` gate claim was VACUOUS.** `plugins.test.ts` mounts `requireDevice` itself, so
    deleting the real mount from `server/index.ts` left all 26 packages green — measured. The case belongs in
    `internalPrincipal.test.ts`, which drives the real `createApp()`, and is there now.
16. **`standaloneParity`'s source half was satisfied by a commented-out call.** Same trap CLAUDE.md documents
    for `boundaries.test.ts`, where leaving comments in is the safer trade because the false positive is
    loud; here it runs the other way, so comments are stripped before scanning.
17. **`tunnel.test.ts` stubbed the allowlist**, i.e. the confinement itself had no coverage. It has a
    dedicated integration suite against a real database now.
18. **The disable cycle reset after three assertions**, so the first genuine failure cascaded into eleven.
    `afterEach` now.
19. Two tests **encoded the old wrong behaviour** and had to be inverted: the tunnel fallback, and the
    "no answer within 0s" deadline string (`Math.round(ms/1000)` for a 50ms deadline).

**Considered and NOT changed:**

- **The client-side loopback listener is unauthenticated**, and the review called it critical. It is real: a
  raw TCP listener carries no credential, so any local process that finds the port can reach the node's
  declared dev port without the device token. security.md § Threat model puts a compromised machine out of
  scope, but this is still a widening, and no cheap authentication exists — the loopback hop would have to
  carry a credential the WebContentsView does not control. What is done instead is bound it: only declared
  ports, only while the pane is open (the pane closes its tunnels on unmount and an idle listener is reaped
  after 60s), and at most `MAX_TUNNELS`. Stated in full at the head of `previewTunnel.ts`. **This is the
  phase's largest accepted risk.**
- **A `scope: 'service'` internal token can tunnel to any task's declared ports.** Correct by design — that
  scope is the node calling itself and is never placed in a child's env — but the invariant is asserted
  nowhere. Left as is; it is the same shape as every other `service`-scope allowance since Phase 2, and
  changing it here would be a policy change made in the wrong place.
- **`declaredTunnelPorts` still ignores `previewMode: 'script'`.** Running a shell command to answer an
  upgrade would make executing repo config incidental, which the config-trust gate exists to prevent. A task
  using a URL script gets no tunnel unless the port also appears as a run target or as `previewMode: 'port'`,
  and the client fails closed. Pinned by a test so it is a decision rather than an oversight.

## Not done

- **No heartbeat on the events socket**, so a hung-but-connected node reads `online` indefinitely. Found by
  the SIGSTOP attempt above. It is a transport change and belongs with protocol.md's stream work.
- **`standalone.ts`'s SIGTERM drain is slow** enough that a socket outlived a 30-second poll. Not
  investigated; SIGKILL is what the e2e uses.
- **Per-endpoint `Idempotency-Key`.** Unchanged from Phase 2 and Phase 3, and for the same reason: the route
  declaration and the client call sites have to land together.
- **Other providers' credential reads are still ungated** (linear, rollbar, database, model-providers),
  exactly as phase2-notes.md and phase3-notes.md left them.
- **Workflows contributes no attention source.** `workflowApi.runs` is per task, so a node-wide "gated runs"
  list would be one request per task on every inbox poll. It needs a node-wide route it does not have.
- **plugins/agents' task sidebar still owns workflow data** — the last ownership question with no import
  behind it, unchanged from Phase 3.
- **The unauthenticated loopback listener** above, which is bounded rather than closed.
- **No test proves the `refuse`/handoff socket-error guards**, because the crash could not be reproduced.
- **Pre-release data roots still do not survive**, per plan.md § Phase 1. The device-prefs seed and the
  unqualified-storage-key fallback mean an existing install upgrades cleanly *within* Phase 4, which is a
  different promise.

## For Phase 5

Phase 5 is polish, the config-only V1 importer, and release. Two things from here that touch it directly:

- **The parity checklist in ui.md now has a fleet half.** Fleet home, the node/plugin settings pages, the
  attention section and the workspace grouping are all `nodes().length > 1` surfaces, so a single-node
  fresh-install walk will not see any of them. Walk it twice.
- **Packaging is still the one thing no test covers.** `spawn(process.execPath, [asarPath])` is unchanged
  from Phase 2, and Phase 4 added main-process code on that path: the tunnel's loopback listeners and the
  node-restart verb. Verify with a real DMG launch before signing off.
