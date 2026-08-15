# State ownership: what lives on the node, what lives on the device

> **Implemented 2026-08-15.** All four composition kinds moved, prefs now address the active node
> rather than a home node, and a one-shot drain hands each device's leftovers back. The rule and the
> shipped split live in [docs/state.md](../../state.md); the rest of this file is the reasoning that
> got there, kept for the record. Dashboards inheriting the rule is still ahead.

From the node-first session (2026-08-15). Nothing here is scheduled. The end goal says any client
that pairs with your node gets *your* acorn. Today that is true for data and false for
arrangement: everything the user composes about their workspace lives in one device's
localStorage.

## The rule

**State follows the resource it describes.**

- State that describes a **node's resources** — a task's pane layout, a task's open files, a
  repo's PR filters, a task's context selection, a saved dashboard panel — belongs to **that
  node**, in its per-user prefs store, so every client renders it and the agent can read it.
- State that describes **this device** — theme and style (different monitors), keybindings
  (different keyboards), window and collapse state, notices, caches, trust acknowledgements,
  tokens — stays **device-local**, on purpose, forever.
- **Drafts stay device-local** by the existing recorded decision (`docs/state.md`; the new-PR
  draft chose no cross-device sync deliberately). Losable is acceptable for drafts; it is not
  acceptable for compositions.

The rule also kills a trap before it lands: there is no "home node" to invent. State goes to the
node whose resource it describes, so the current `homeNode()` pick — first local node, else
whichever is first in the list (`client-core/src/node/fleet.ts:49-50`) — stops mattering for
anything that does.

## What the survey found (2026-08-15)

- The node has a real per-user prefs store — `prefs(userId, key, value)` behind
  `GET|PUT /v2/core/prefs`, scoped by principal (`node-core/src/server/db/schema.ts:21`,
  `routes/prefs.ts`). After the device-prefs migration, **only three keys still live in it**
  (onboarding, startup context injection, agent-tool permissions). Everything else moved to
  localStorage via the `DEVICE_KEYS` set (`client-core/src/persistence/devicePrefs.ts:3-32`).
- The trapped compositions, all currently device-local: **task pane layouts**
  (`core:task-layouts`), **editor open-file sets**, **PR filters**, **context section
  selections**. The structural tell: their storage keys already embed the node id and task id
  (`persistence/persistedState.ts:71-80`) — they describe node resources and live on the device.
  GitHub's `viewed_files` and `pinned_repos` are the same class of fact and correctly live
  node-side, which shows the split is a migration artifact, not a decision.
- `docs/state.md` contradicts itself about this: its scope table says task layout is "Node +
  task" while the code stores it on the device. (Corrected in that file as part of this review;
  the table now matches the code, and this file is the proposal to change the code.)

## The moves

Move the four trapped composition kinds into the owning node's prefs, keyed as they already are
(scope key stays; the store changes):

1. **Task pane layouts** — the strongest case: a user builds them per task, and the
   unknown-pane-ids-survive-inert rule already makes them safe under plugin lifecycle.
2. **Editor open-file sets** (per task).
3. **PR filters** (per repo/source).
4. **Context section selections** (per task).

Mechanics, deliberately boring: these already flow through `savePref`, which already knows how to
write node prefs — the change is removing them from `DEVICE_KEYS` and letting the existing
node-prefs path carry them, debounced. Reads keep the query cache as the offline fallback exactly
like every other node-backed read; last write wins; no sync engine, no merge machinery. The
honest cost: editing a layout while its node is offline stalls the write until reconnect, where
localStorage never stalled. That is the correct trade for state that is *about* that node.

**Dashboards inherit the rule from day one.** Panel and dashboard definitions
(`docs/future/dashboards/composition.md § The persisted model`) are node-side per-user prefs, not
device state — noted there now. A user builds a board once and every device shows it.

**Keybindings, theme, rail order stay device-local.** They describe the device and the person at
it, not a node. If roaming preferences are ever wanted, that is an export/import feature, not a
storage move.

## What this buys the end goal

- A second device — or the future web client — pairs and *is your acorn*, arrangements included.
- The agent can see and (through the normal approval flows) shape compositions, because they live
  behind `/v2` like everything else it can reach. "Make my task layout look like X" becomes
  possible; localStorage is invisible to the node side by construction.
- Backups start covering compositions (node prefs are in the sqlite snapshot; localStorage is in
  nobody's backup).

## Not proposed

- No cross-device sync service, no CRDTs, no merge UI. Per-user prefs on the owning node,
  last-write-wins.
- No moving custody (trust, tokens, cert pins) or caches off the device — those are per-device by
  design and the trust argument is written at `pluginTrustStore.ts` ("pairing a new laptop
  re-prompts, exactly as it re-pairs").
- No draft sync (recorded decision stands).

## Verify before building

Whether `DEVICE_KEYS` still holds the four composition kinds; whether the prefs table is still
principal-keyed with the flat key vocabulary in `persistence/prefKeys.ts`; whether
`persistedState` scope keys still embed node and task ids; and whether dashboards started
building against device storage in the meantime (if so, stop that first).
