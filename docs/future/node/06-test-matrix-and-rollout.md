# Phase 6: prove the combinations and roll the protocol forward safely

Status: proposal, 2026-09-26. Not started. This phase closes the programme; its focused tests land
with the behavior phases they cover.

Part of [Node-provided UI](./README.md).

## Goal

Turn the lifecycle failures from this audit into repeatable tests at the layer that owns each
contract. Roll out the additive node protocol before clients depend on it, preserve device trust and
layout state, and finish with real-window, terminal, and multi-node evidence.

## Baseline evidence

On 2026-09-26 the audit ran these focused suites without changing code:

```sh
pnpm --filter @acorn/client-core exec vitest run \
  src/host/trust/resolveBundles.test.ts \
  src/host/plugins/contributions.test.ts \
  src/host/plugins/reload.test.tsx \
  src/host/trust/trustModel.test.ts \
  src/host/tree/workerHost.test.ts \
  src/host/tree/RemoteTree.test.tsx \
  src/host/tree/RemoteTree.grants.test.tsx \
  src/host/frames/register.test.ts \
  src/host/chrome/chromeRegister.test.ts

pnpm --filter @acorn/node-core exec vitest run \
  src/server/pluginHost/state.test.ts \
  src/server/routes/plugins/plugins.test.ts
```

The client run passed 129 tests in nine files. The node run passed 61 tests in two files. Those 190
tests show that current local contracts agree with their current expectations. They do not cover the
fleet and lifecycle combinations in this programme.

Specific coverage gaps at the baseline:

- `reload.test.tsx` mocks distribution, so it cannot catch stale fleet state or repin ordering;
- the trust rejection test assumes a first install and expects no contribution sync;
- worker tests use one fixed plugin id and do not try identical bytes under two ids;
- remote-tree tests do not mount two live `RemoteTree` components on one bridge;
- no suite changes an inactive node, reconnects it, unpairs it, or switches to it;
- no suite combines a pending disk update with an old booted node identity; and
- settings, importers, and footer slots are not exercised across a node switch or failed runtime.

Re-run the baseline before implementation. Counts are historical evidence, not a permanent target.

## Test architecture

Use the narrowest layer that can prove each invariant.

| Layer | What it proves | What it does not mock |
| --- | --- | --- |
| Pure transition tests | Runtime normalization, fleet reconciliation, trust selection, availability, stale-generation rejection. | State inputs and expected snapshots. No Solid effects or network. |
| Node state tests | Boot snapshot versus disk candidate, reload commit, failure state, hash-addressed bundle service. | The real state projection and loader snapshot shapes. |
| Client integration tests | Events enter the queue, custody results feed selection, one snapshot drives registries, node switches are atomic. | Distribution itself. Fake node transport and custody are acceptable seams. |
| Worker and tree tests | Composite principal key, slot routing, focus/document isolation, cancellation and revocation. | The real worker host and broker schemas. A stub Worker supplies ports. |
| Desktop boot and real-window tests | Composition roots wire the state machine, trust UI copy, Settings fallback, visible node switches. | The packaged renderer and Tauri window. |
| Terminal tests | The shared distribution, custody, and worker contracts survive the terminal projection. | Shared client-core modules. Only host drawing and platform services are adapted. |
| Multi-node smoke | Real event source ids, reconnect, inactive-node update, pair and unpair. | Node processes, broker routing, and client cache. |

Avoid tests that only repeat a type guard or assert implementation call order without a user-visible or
authority invariant. The valuable tests cross a boundary that previously hid a mismatch.

## Required scenario matrix

### Runtime identity and distribution

| Scenario | Expected selected UI |
| --- | --- |
| One node, clean active 1.0, accepted | 1.0. |
| Active 1.0, installed 2.0, 1.0 accepted, 2.0 pending | 1.0; update prompt present. |
| Active 1.0, installed 2.0, both accepted | 1.0 until runtime commit, then one atomic swap to 2.0. |
| Active 1.0, installed 2.0, 2.0 rejected | 1.0 while the node still runs it. |
| Runtime commits unaccepted 2.0 | No loaded UI for that plugin on that node; prompt present. |
| Runtime commits rejected 2.0 | No loaded UI; no repeat prompt; Settings explains rejection. |
| Active 1.0, package uninstalled on disk | 1.0 until restart, served from retained active bytes. |
| Boot load fails | No loaded UI; failed state and bounded reason. |
| Reload to 2.0 fails after 1.0 was active | 1.0 remains selected with candidate failure warning. |
| Client-only package update | Old or new selection follows the documented trust transition without a node restart. |
| Old node protocol, row active | Conservative legacy adapter allows the coherent case. |
| Old node protocol, pending or failed | Loaded UI withheld; compatibility diagnostic recorded. |

### Fleet lifecycle

| Scenario | Expected reconciliation |
| --- | --- |
| Node A starts, node B arrives with unique plugin | B's plugin is observed and selectable on B; A's selections do not move. |
| B arrives with higher version of A's plugin | Each node selects its own active runtime; no global repin. |
| B updates while A is active | B observation updates from its source-aware event; active A registrations remain. |
| Switch A → B with different accepted hashes | One registry replacement to B's set, with B data and availability in the same commit. |
| B reconnects after changing plugins | B is re-read even though it connected before. |
| B roster read fails | Last valid B observation remains stale and unreachable, not empty. |
| B is unpaired during a read | B disappears immediately and the late response is discarded. |
| Two events race for B | Only the newer generation publishes. |
| Unrelated plugin changes on A | No selection for another plugin or node changes without a corresponding input diff. |

### Trust and revocation

| Scenario | Expected transition |
| --- | --- |
| Accept | Durable write succeeds before selection; one contribution sync when usable. |
| Trust write fails | Prompt and selection remain unchanged. |
| Reject update | Compatible accepted old selection remains; candidate is durably quiet. |
| Dismiss | No durable write and no selection change; request remains discoverable. |
| Reconsider rejection | Explicit owner action creates a new pending decision path without changing bytes silently. |
| Revoke exact acceptance | Frames and workers stop, descriptors withdraw, and prompt state follows in one transition. |
| Revoke dev grant | Every auto-accepted key covered by it withdraws immediately. |
| Same key from two nodes | One decision covers equivalent declarations and locally verified bytes. |
| Same key, conflicting enforced declarations | Withhold and report conflict. |

### Worker and mounted trees

| Scenario | Expected isolation |
| --- | --- |
| Plugin ids A and B, identical bytes | Two workers and two principal-bound bridges; one cache file is allowed. |
| One plugin, one hash, two trees | One worker; separate slots and scoped bridge proxies. |
| Two task scopes | API, navigation, keydown, state, and selection stay with the caller's slot. |
| Document tree plus non-document tree | Only the document slot receives document effects. |
| Gesture in tree A, call from tree B | B is denied unless B has its own focus or gesture proof. |
| First tree unmounts | Second remains functional; first slot and pending calls are rejected. |
| Trust revoked during idle grace | Worker and bridge stop immediately. |
| Targeted selection and surface action | Only the named mount receives it. |
| Appearance change | All live mounts receive the intended bundle-wide update once. |

### Contribution availability

For each state `unknown`, `unreachable`, `absent`, `disabled`, `failed`, `waiting-for-restart`, active
old with pending candidate, active with failed reload, pending trust, rejected, and accepted, cover:

- a compiled pane with `{ plugin: id }`;
- a loaded task pane and project pane;
- a loaded settings page;
- a loaded project importer, including one already open;
- a loaded task footer and topbar entry;
- a command and its keybinding;
- a context menu or source action; and
- a cooperative extension contribution.

Use table-driven tests around the shared selector, then one integration case per registry shape. Do not
multiply every registry by every state when the common typed gate already proves the cross-product.

## Delivery slices

Each slice is independently reviewable and preserves the old protocol until the migration is complete.

### Slice 0: worker principal key

Land [phase 0](./00-worker-identity.md) and its identical-byte test first. Add immediate worker
invalidation if its caller contract is already available; otherwise land the key and track the
invalidation line in slice 3. This slice has no wire or persisted-state migration.

### Slice 1A: additive node protocol

Land phase 1's active snapshot, retained bytes, and hash-addressed bundle route. Keep legacy fields.
Old clients continue reading `installed`, and new fields are ignored. Verify both the standalone node
and desktop-bundled node composition roots build the same bridge.

### Slice 1B: client runtime adapter

Teach client-core and the terminal to prefer the active snapshot and conservatively adapt old rows.
Do not replace distribution selection yet. At this point diagnostics can compare current and proposed
answers without changing registrations, which is useful during development.

### Slice 2: fleet snapshot

Replace the independent distribution signals, source lifecycle events, and global repin. Keep
compatibility selector exports while consumers move. Commit active-node registration only after the
new snapshot is complete.

### Slice 3: trust transitions

Move pending, accepted, rejected, and selected state into the snapshot. Correct dialog copy, accept,
reject, dismiss, normal revocation, and dev revocation together. Wire immediate worker invalidation.
Shipping only the dialog change or only the resolver change leaves the false-fallback gap open.

### Slice 4: per-tree authority

Add scoped wire messages and SDK compatibility, move services onto slots, then change targeted host
pushes. Rebuild every bundled loaded plugin and run the old-protocol compatibility fixture.

### Slice 5: availability and registry audit

Replace the two legacy predicates and fill settings, importer, and footer gates. Move registry hosts to
the shared availability selectors and add the structural guard against unowned route-bearing loaded
contributions.

### Slice 6: close and migrate docs

Run the full gates and manual matrix, update owning docs, record deviations, and either mark this
folder shipped or delete it after moving durable decisions according to the repository's future-doc
practice.

## Persisted-state migration

The programme must preserve:

- trust acknowledgements and remembered rejections;
- development grants, subject to explicit revocation behavior;
- content-addressed cached bundle files;
- pane layouts and contribution ids;
- plugin state preferences; and
- per-node query caches.

The runtime identity is additive protocol data, not a database migration. Keep it optional while old
query-cache responses can exist. If implementation needs a required shape, bump only the plugin-roster
query key and document the cache migration rather than clearing all per-node caches.

The distribution snapshot is renderer memory. Do not persist its selected winners; derive them from
node runtime observations, device cache, and durable trust on boot. Persisting a second winner record
would create another stale source after unpair or rollback.

If cache provenance changes from singular metadata to reference records, migrate the index in place
and retain the content files. Invalid metadata can be rebuilt from current offers without discarding a
previously accepted hash.

## Rollback

- Slice 0 rolls back by process restart; it changes no data.
- The additive node protocol can remain when a client rolls back. Old clients ignore it.
- A node rollback removes `active`; updated clients enter the documented conservative legacy path.
- Distribution and trust rollback must not rewrite or downgrade custody records. Old code can read the
  unchanged `(pluginId, hash)` acknowledgement schema.
- The tree wire keeps its old-protocol path for the supported plugin API major, so a client rollback
  does not require rebuilding installed packages.
- No slice deletes layouts or plugin state as a recovery mechanism.

If a rollout has to disable the new client selector, use a temporary development flag only while both
paths are present and covered. Remove the old path when the protocol floor is established; do not keep
two permanent lifecycle implementations.

## Diagnostics and measurement

Use existing privacy-safe telemetry and logs. Useful fields are:

- distribution snapshot revision and reconcile reason;
- source node id and plugin id;
- transition kind, such as `node-arrived`, `runtime-changed`, `trust-revoked`, or `node-unpaired`;
- hash prefix where current security logs already use one, never bundle contents;
- stale generation discarded;
- selected, withheld, or registration-failed result; and
- reconciliation duration and number of nodes and candidates.

Do not log permission payloads, plugin state values, task ids, document content, API bodies, or URLs
opened from a tree. A focused debug view in Settings may show current structured state without creating
a second authority source.

Watch these regressions during the real pass:

- repeated registry rebuilds when a snapshot's effective active selection did not change;
- one bundle fetch per reconciliation despite an existing cache entry;
- worker count growing by tree rather than by principal bundle on the new protocol;
- stale workers surviving revocation; and
- node switch rendering a frame from the previous node for one paint.

## Automated gates

Each behavior slice runs its focused tests plus the packages it changes. Before programme acceptance:

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/desktop test
```

Also run architecture tests that cover documentation paths, platform boundaries, protocol snapshots,
and any new registration ownership guard. Use `pnpm test`, not an unbounded direct Turborepo test run.

## Real-host acceptance

### Desktop window

Use the repository driver on a graphical host:

```sh
pnpm dev:agent -- --session node-plugin-lifecycle
pnpm dev:agent:ui -- --session node-plugin-lifecycle snapshot
```

After every transition, take a fresh snapshot before using element references. Exercise:

1. accepted old runtime plus installed update;
2. reject, reconsider, accept, and restart;
3. switch between two nodes on different accepted versions;
4. update the inactive node, then switch to it;
5. fail a plugin load and a live reload;
6. open Linear's task pane and project or reference surface together and use links in both;
7. revoke a dev grant while a remote tree is mounted; and
8. verify loaded settings, importer, footer, commands, and topbar disappear or disable on a node that
   lacks the plugin.

Finish with:

```sh
pnpm dev:agent:ui -- --session node-plugin-lifecycle stop
```

The renderer driver cannot cover native dialogs or host-owned child webviews. None is central to this
programme; use native computer control only if implementation moves a tested transition onto one.

### Multi-node

Run two isolated node data roots and ports through the supported local-development helpers. Pair both
with one client. Capture node ids and versions in the test record, then perform arrival, inactive
update, reconnect, switch, unpair-during-read, and rollback scenarios from the matrix. A fake fleet
integration suite is required as well; the live smoke proves broker source identity and composition
wiring.

### Terminal

Start the terminal host against the same accepted bundles. Prove that per-node selection, trust
withholding, worker identity, targeted tree selection, and availability agree with desktop. Expected
host differences such as no overlay or external window remain the terminal contract and are not
failures.

## Docs migration

Each phase lists its owning docs. At closure, verify at least these pages state shipped behavior:

- `docs/architecture-overview.md`;
- `docs/plugins/activation.md`;
- `docs/plugins/client-authoring-and-the-ui-kit.md`;
- `docs/plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md`;
- `docs/plugins/frames.md`;
- `docs/security.md`;
- `docs/caching.md`;
- `docs/api-reference.md`;
- `docs/contribution-kinds.md`;
- `docs/state-ownership.md`;
- `docs/ui-design.md`;
- `docs/shell.md`;
- `docs/tui/chrome-and-plugins.md`; and
- `docs/testing.md`.

Update code comments that currently claim one worker per hash, pin once per session, or equate
`running` with loaded UI eligibility. Do not leave the proposal as the only true description after a
phase ships.

## Done when

- Every row in the required scenario matrix has automated coverage at its owning layer, except the
  explicitly real-host checks, which have a dated record.
- Node-first, client-first, old-node, old-client, and rollback combinations parse and follow the
  documented conservative behavior.
- Existing trust, cache, layout, and plugin state survive the migration.
- `pnpm lint`, `pnpm test`, the desktop package test, terminal-focused tests, multi-node smoke, and the
  real Tauri pass are green.
- Owning docs contain the final contracts and this folder records any changed decision.

## Verify before building

- Re-run the focused baseline commands and inspect changed test names rather than relying on the 190
  historical count.
- Confirm root `pnpm test` still applies the repository's bounded Turborepo concurrency.
- Confirm the desktop package test still stages bundle inputs before boot and Rust tests.
- Confirm `docs/local-development.md` still documents the `dev:agent` and `dev:agent:ui` workflow and
  the supported way to run two isolated nodes.
- Confirm query caches still have no universal version buster before making protocol fields required.
- Confirm trust and cache schemas can read existing rows before changing either writer.
