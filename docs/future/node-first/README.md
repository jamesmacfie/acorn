# Node-first: the architecture review for the end goal

An architecture review from the node-first session (2026-08-15). Nothing here is scheduled. The
lens: **simplicity and maintainability**, not capability — capability was assessed in
`docs/future/ecosystem/` and the verdict there stands.

## The end goal being reviewed against

Three sentences, so every file in this folder argues from the same place:

1. **Every node is standalone.** The desktop is one client of a node, not the node's home. A node
   is a download, runs anywhere, and carries the product.
2. **The node provides the UIs.** Plugins live on the node; the node serves their bundles and
   descriptors to every client that pairs with it — desktop today, web and terminal later. A
   client is a renderer and a composer, plus custody (trust, tokens) and a few host-owned
   surfaces.
3. **Anyone can add plugins.** Point a node at a folder, install from a URL, or — the loop in
   `docs/future/user-extensions/` — have the agent inside acorn write one. You can use acorn to
   make your own acorn.

The simplicity test every finding applies: **does this thing exist once, on the right side of the
node/client line, with one way to do it?**

## The verdict

The fundamentals are right, and better than the folder structure suggests. What blocks the goal
is not architecture that points the wrong way — it is four specific gaps, three of them cheap.
Big breaking changes are allowed right now and one finding has a deadline attached to that
allowance: the freedom to break the client↔node wire ends the day the first standalone node is
downloaded, because from then on old nodes exist forever.

## What is already right (so nobody re-litigates it)

- **The node owns everything product-shaped.** All product state and execution is behind `/v2` +
  one WebSocket. The node serves plugin bundles (`/v2/core/plugins/:id/client.js`) and the roster;
  trust binds to bytes the device hashed itself.
- **The transport vocabulary is already network-shaped.** Every former preload bridge (editor,
  search, terminal verbs, git, notes, memory, MCP) now speaks HTTP paths and WS frames. The bytes
  still ride one Electron IPC pipe (`acorn:node-fetch` / `node-send`), but swapping that pipe is a
  change to two modules (`apiClient.ts`, `wsClient.ts`), not a migration.
- **Plugins own their wire contracts** (`shared/` / `contract/`), enforced by arch tests, so a
  plugin can define its API without editing core — the precondition for third-party.
- **The compiled tier is cheap per plugin.** A compiled plugin costs exactly one line in
  `apps/desktop/src/app/client/plugins.ts` and one in `apps/node/src/server/plugins.ts`; it
  registers itself through `ctx`. There are zero production import edges into the five loaded
  plugins. A loaded plugin can shadow a built-in by id (`composition.ts`), which is the migration
  escape hatch, already wired.
- **The guardrails are tests, not documents** — boundaries, CSS ownership, surface snapshots,
  standalone parity.

## The findings

Ranked by leverage toward the goal. Each has its own file with the evidence and the fix.

| # | Finding | Why it blocks the goal | File |
|---|---|---|---|
| 1 | ~~**There is no client↔node compatibility contract.**~~ **Shipped 2026-08-15.** The contract is `docs/api-reference.md § Versioning`: handshake schemas are additive-forever, the broker re-probes the major on every connect and produces `incompatible`/`protocol_mismatch`, and the dead `protocolVersion`/`appVersion` fields are gone. | Was the one finding with a deadline — it had to land before the first standalone release. It did. | [version-skew.md](./version-skew.md) (spent) |
| 2 | **User compositions are trapped on one device.** Task layouts, editor open-file sets, PR filters, and context selections are keyed by node and task but stored in the device's localStorage. The node's prefs table is almost empty. | "Any client connects and gets your acorn" is false today for everything the user arranged. Dashboards would inherit the same trap. | [state-ownership.md](./state-ownership.md) |
| 3 | ~~**The platform seam is a type, not a boundary.**~~ **Shipped 2026-08-15.** The seam is `packages/client-core/src/platform/` — capability-grouped, nullable, Electron preload as its only implementation — with an empty-baseline arch rule banning `window.acorn` everywhere else, and the folder-picker probe split from "does this node run terminals". | Was: every reach is a line a web client trips over, and the probe bug hid how portable the client already is. Both fixed. | [platform-seam.md](./platform-seam.md) (spent) |
| 4 | **Twelve compiled plugins and the private registries only they can use.** Some registries are dead, some die the day one plugin moves, and four in-realm couplings (memory↔context, changes↔agents, workflows↔agents, github↔project row) have no designed seam. | Whatever is compiled into the client is invisible to a web or terminal client and unreachable for the agent-author tier. | [compiled-tier.md](./compiled-tier.md) |

## The order

1. **Version-skew first** (finding 1). Small, and it is the one with a closing window. Land it
   before `docs/future/bundle.md`'s release pipeline ships anything.
2. ~~**The platform ratchet and the probe fix**~~ (finding 3). Shipped 2026-08-15, the day after this
   folder was written. Mechanical and cheap, as predicted; the probe fix unhid the terminal, agents,
   run-target and workflow surfaces on every non-Electron host.
3. **State ownership** (finding 2). Adopt the rule, move the four trapped composition kinds
   node-side. Do it before dashboards phase 2 so panels never learn the wrong home.
4. **The compiled-tier map** (finding 4) is not a phase — it is the standing answer to "which
   plugin moves next and what gets deleted when it does". Moves stay opportunistic, per
   `docs/extensibility.md § Unexercised seams rot`.

This folder does not reorder `docs/future/ecosystem/work-plan.md`; it inserts preconditions into
it (noted there).

## Refused, on the record

- **No OpenAPI, codegen, or response schemas** for the skew problem. The contract is a version
  number, an additive-only rule, and tolerant parsing — discipline, not machinery.
- **No tier unification.** The compiled/loaded split stays; the fix is fewer compiled plugins and
  fewer private registries, not a framework that makes the two tiers look alike.
- **No syncing genuinely per-device state.** Theme, window state, caches, trust, and tokens are
  per-device on purpose and stay there.
- **No sandbox widening**, ever, as a shortcut for any of this. Recorded stance:
  `docs/future/ecosystem/shell-vision.md`.

## Drift warning

Every claim here was verified against the tree on **2026-08-15** (three code surveys; evidence
paths in each file). Paths are hints; mechanisms and decisions are the durable part. The owning
docs for current behavior are `docs/architecture-overview.md`, `docs/plugins.md`,
`docs/security.md`, `docs/electron.md`, and `docs/state.md` — where this folder disagrees with
those, those win, except where a file below names a specific documented claim as stale (each
names the correction).
