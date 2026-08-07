# Phase 5 handoff

Phase 4 is done and committed. This is what you need to know that is not obvious from the code, ordered by
how likely it is to bite you.

## Where things stand

Thirteen commits, oldest first. `2dab5d95` is the last Phase 3 commit, so `git log 2dab5d95..HEAD` is the
whole phase.

| Commit | What |
| --- | --- |
| `16ca3943` | client disable-cycling test; the two plugins doing I/O in `init` |
| `b23a64a3` | the per-node plugin toggle, owned by the node |
| `59d6c44a` | node-scoped state leaking across a node switch |
| `0313ae7e` | `createFleetQuery`, the one fan-out primitive |
| `858c0f43` | Fleet home |
| `63ce4b2c` | the attention inbox |
| `ff8e4d2c` | aggregated Agent Center / pickers / palette |
| `8044fad2` | freshness in panes; offline writes fail fast and keep the text |
| `598d6022` | Settings → Plugins + local node restart |
| `b09b39aa` | the preview tunnel |
| `7ba9439a` | remote parity, device prefs, nodeId in scoped keys |
| `08707214` | the two-node e2e exit criteria + phase4-notes.md |
| `23f4f38f` | **the adversarial review — 14 findings, 8 security** |

Gates at HEAD: `pnpm lint` 26/26 · `pnpm test` 26/26 · `pnpm --filter @acorn/arch-tests test` 14/14
(plugin→plugin still `[]`) · `node scripts/db.mjs check` 9/9 · `pnpm --filter @acorn/desktop test:e2e` 12/12.

**Read [phase4-notes.md](./phase4-notes.md) before touching a fleet surface.** In particular its "adversarial
review" section: the phase's first draft of several things was wrong in ways that looked fine, and the section
says which. If a comment in the fleet code reassures you, check whether it is one of the corrected ones.

## Three risks accepted, not closed

These are live in the shipped code. Phase 5 should decide about them explicitly rather than inherit them.

**1. The preview tunnel's client-side loopback listener is unauthenticated.** `previewTunnel.ts` binds
`127.0.0.1:0` and pipes anything that connects to the remote node's declared dev port, using main's device
token. A raw TCP listener carries no credential, and no cheap one exists — the loopback hop would have to
carry something the `WebContentsView` does not control. It is bounded instead: declared ports only, only while
the pane is mounted, reaped after 60s idle, capped at 16 concurrent. security.md § Threat model puts a
compromised machine out of scope, which is the argument for accepting it; the counter-argument is that this
converts "acorn holds a token for the build box" into "any local process reaches that box's port". **If Phase 5
wants this closed, the shape is a per-tunnel secret in the path plus a rewriting proxy, which is a real
build.**

**2. There is no heartbeat on the events socket.** A node that has hung, or a laptop that slept without
dropping its TCP connections, reads `online` indefinitely — found by trying SIGSTOP in the e2e. Everything
downstream inherits it: every `NodeChip`, `apiClient`'s offline fail-fast, and the tunnel's willingness to keep
a listener pointed at a sleeping node. A WS ping/pong watchdog is the fix and belongs with protocol.md's stream
work, not bolted on.

**3. `standalone.ts`'s SIGTERM drain is slow** — slow enough that its listening socket outlived a 30-second
poll in the e2e, which is why that test uses SIGKILL. Not investigated. It matters for the launchd/systemd
story Phase 5 owns: an operator's `systemctl restart` may take longer than they expect.

## Phase 5's own scope, with what Phase 4 changed under it

plan.md § Phase 5 is: the config-only V1 importer, the ui.md parity checklist, backup/restore, the
disk-encryption warning, an audit surface, and packaging.

**The parity checklist now has a fleet half, and a single-node walk will not see it.** Fleet home, Settings →
Plugins' node picker, the Agent Center scope toggle, the workspace picker's grouping, the attention section's
node badges and the ⌘K palette's node hints are all gated on `nodes().length > 1` — deliberately, because
ui.md says first-run must never mention nodes. **Walk the checklist twice: once single-node, once with a
second node paired.** `apps/desktop/e2e/twoNode.spec.ts`'s `pairTwoNodes()` is the fastest way to get a
two-node app up by hand.

**Packaging is still the one thing no test covers**, unchanged from Phase 2, and Phase 4 added main-process
code on that path: the tunnel's loopback listeners (`previewTunnel.ts`), the node-restart IPC verb, and the
`spawn(process.execPath, [asarPath])` boot that has never had a test. Do
`pnpm --filter @acorn/desktop dist` and launch the real DMG before signing anything off. Specifically check
that the tunnel works from a packaged build — it uses `ws` from `apps/desktop`'s dependencies and
`electron-builder` prunes devDependencies.

**The importer touches prefs, and prefs are now two tiers.** `persistence/devicePrefs.ts` splits them:
presentation and layout are the DEVICE's (localStorage, `acorn-pref:` prefix), per-machine behaviour
(`agent_tool_permissions`, `startup_context_injection`, `onboarded`) stays on the node. A V1 importer that
writes prefs must respect the split, or it will PUT theme changes to a node that no longer reads them.
`prefsOptions` merges the two with device winning, and `seedDevicePrefs` copies node values across once — so
an importer can write node prefs and let the seed migrate them, which is probably what you want.

**Storage keys are node-qualified now.** `storageKeyFor` writes `<sliceKey>:<encodedNodeId>/<encodedScopeId>`
for every non-`app` scope. An unqualified key is still accepted on read (that is every key written before
Phase 4), so an existing install upgrades cleanly — but an importer that fabricates keys must qualify them or
they will read as "some other node's" and be ignored. `packages/client-core/src/persistence/scopedKeys.test.ts`
is the contract.

**`audit` (data.md § Core DB) is still an empty promise.** No table, no writes. Phase 4 added two things that
security.md says belong in it: pairing-adjacent device revocation from the new Settings → Nodes device list,
and the plugin enable/disable decision. If Phase 5 builds the audit surface, those are two of its first
producers.

## Landmines, in the order you will hit them

**A fan-out sharing a query key must share the value's SHAPE.** `createFleetQuery` calls `fetchQuery`, which
writes through the node's own cache — that is the feature (it warms what the rail reads) and the trap. Fleet
home's first version fetched `.length` under `tasksKey`, so a number landed where every other surface expects
`Task[]`; the rail and palette threw `.find is not a function`, the uncaught render error **wedged Solid's
flush queue**, and the only visible symptom was a badge that stopped updating. Stated at length in
`node/fanout.ts`. If a fleet surface mysteriously stops reacting, look for a page error first.

**`index.tsx` remounts the whole shell per node.** `<Show keyed>` on `activeCacheId()`. So an
`on(activeNodeId, …, { defer: true })` effect inside `App` NEVER fires on a switch — the fresh one defers, the
dying one is disposed before user effects flush. That killed the client half of Settings → Plugins for a
commit. A plain mount effect is the right shape *because* of the remount.

**Module-level state does not respect the per-node cache partition.** Two Phase 4 commits swept it and the
review found a third batch. Anything you add as a module signal keyed by a task/workspace id must either be
node-keyed or cleared in `apps/desktop/src/app/client/scopedEviction.ts`'s `runtime:node-switched` handler.
The reason it matters twice over: `storageKeyFor` reads the active node at WRITE time, so a stale scope in a
module map gets persisted under the *new* node's key.

**A guard mounted at one path form is not mounted.** Hono's trailing `/*` matches zero segments, so
`/v2/core/x/*` covers `/v2/core/x` too — but the codebase mounts both forms everywhere and you should too.
And **test the gate through `createApp()`**, not by mounting the middleware in the test: `plugins.test.ts` did
the latter and deleting the real mount left all 26 packages green.

**A source-text assertion needs comments stripped.** `standaloneParity.test.ts` was satisfied by a
commented-out call. Note the asymmetry with `boundaries.test.ts`, which deliberately does *not* strip: there a
comment produces a loud false positive, here it produces a silent false negative.

**Non-vacuity means breaking the thing the assertion names, then checking WHICH line fails.** Three of the
review's findings were tests that passed with the behaviour removed. Two of my own new tunnel tests were
vacuous on first write (the revocation callback was masked by the sweep; the RST guard could not be
reproduced at all and is labelled precautionary rather than proven).

**The suite is load-sensitive** and the split made it more so. A full `pnpm test` occasionally fails one
package that passes in isolation — I saw `pairing.test.ts` and `secretBox.test.ts` do it. Verify in isolation
before believing a failure, and never loosen a production timeout to suit the runner. (One historic instance
of "load sensitivity" turned out to be a genuine 1-in-4096 flake in `secretBox.test.ts`, fixed in `b23a64a3`
— so do check.)

**e2e is the only UI proof, and `availableSources` filters provider-gated sources.** A fresh smoke root
connects no integrations, so linear and rollbar never appear in a rail assertion. Seed connected rows if you
assert on the rail.

**`pnpm --filter @acorn/desktop test:e2e` builds first; `npx playwright test` does not.** I lost twenty
minutes debugging a "fixed" bug against a stale `service.js`. Always use the package script.

## Left undone deliberately

From phase4-notes.md § Not done, the ones Phase 5 might care about:

- **Per-endpoint `Idempotency-Key`** — unchanged since Phase 1. protocol.md requires it for create-PR,
  post-comment and send-agent-turn. The route declaration and the client call sites have to land together;
  nobody has done either.
- **Other providers' credential reads are ungated** (linear, rollbar, database, model-providers). Phase 2
  and 3 both left this; a task-scoped agent can still spend those credentials.
- **A `scope: 'service'` internal token can tunnel to any task's declared ports.** Correct by design (that
  scope is the node calling itself, never in a child's env) but asserted nowhere.
- **Workflows contributes no attention source** — `workflowApi.runs` is per task, so a node-wide "gated runs"
  list needs a route it does not have.
- **plugins/agents' task sidebar still owns workflow data** — the last ownership question with no import
  behind it, open since Phase 3.
- **`forEachConnection` still has zero callers** and `storageFootprint` still does not measure the
  `plugins/*.sqlite` files — named in phase2-notes.md as cleanup, still true.

## Fastest way in

```
pnpm lint && pnpm test                      # 26/26 both
pnpm --filter @acorn/arch-tests test        # 14/14, plugin→plugin must stay []
pnpm --filter @acorn/desktop test:e2e       # 12/12 — BUILDS first, use this not npx playwright
```

Then read, in this order: `docs/vNext/phase4-notes.md` (the whole thing),
`packages/client-core/src/node/fanout.ts` (the key-shape rule), `apps/desktop/src/app/main/previewTunnel.ts`
(the accepted risk, stated at the head), and `apps/desktop/e2e/twoNode.spec.ts` (how to get two nodes up).
