# Acorn vNext

Acorn today is one Electron app: a SolidJS renderer talking to a Hono server that runs in an
Electron utility process on the same machine. vNext splits that into two products that talk over a
network protocol:

- **Acorn Node** (`apps/node`) — an Electron-free service that owns everything real: workspaces,
  repos, worktrees, tasks, agents, terminals, Git, processes, Docker, integrations, SQLite, secrets.
  It runs on any machine.
- **Acorn Desktop** (`apps/desktop`) — the Electron client. It bundles and supervises a local Node,
  and can also pair with remote Nodes. One window shows the whole fleet.

Features are **plugins**: one Turborepo workspace package each, with a node part and a client part,
wired into core through registries. GitHub, Terminal, and Agents are required plugins; the rest can
be disabled.

## Goals

1. The Node runs headless on a remote box (e.g. a beefy dev machine) and the desktop app drives it
   exactly like the local one. Workspaces live where their repos live.
2. One fleet shell: aggregated Agent Center, attention, and search across nodes, with every
   resource tagged by its node. A workspace belongs to exactly one node — no replication, no
   cross-node transactions.
3. A real plugin seam: features live in `plugins/*` packages, import core only through
   `packages/*`, and never import each other's internals. The ~25 known cross-feature imports in V1
   are broken for good.
4. Fresh-install parity with V1: same panes, sources, shortcuts, themes, and behavior. Fleet and
   pairing surfaces are additive.
5. Clean start: vNext uses a new data root and a new `/v2` protocol. V1 data is never touched;
   `/api/v1` is gone. A small importer copies workspace/repo *configuration* only.

## Non-goals (deliberately out)

These were in an earlier draft of this spec and are consciously dropped. The architecture leaves
the door open; vNext ships none of them:

- **Third-party / marketplace plugins** — all plugins are first-party, in-repo, compiled into the
  release. No WASI sandbox, no native-process sandbox, no signing, SBOMs, trust tiers, or install
  ceremonies. If we ever want community plugins, the plugin API is the seam to harden.
- **Declarative/bespoke UI machinery** — plugin UI is ordinary SolidJS code in the client. No
  server-driven UI documents, view-session patch protocols, renderer capability negotiation, or
  sandboxed UI origins.
- **PKI** — no per-node certificate authority, mTLS device certificates, rotation journals, or
  recovery ceremonies. Pairing is a code + a pinned server certificate + a revocable device token.
- **Relay transport and mobile clients** — future products. We keep resources node-qualified and
  the protocol Electron-free, which is all the future-proofing they need.
- **Spec bureaucracy** — no requirement IDs, traceability matrices, evidence bundles, or closure
  reports. These docs are the plan; tests are the proof.
- **Mixed queue/replication event bus** — the event stream is a live notification/invalidation
  channel, not a durable replication log. Clients refetch after a gap. Features that need durable
  ordered history (agent transcripts) own it in their own tables.

## The documents

| Doc | Contents |
| --- | --- |
| [architecture.md](./architecture.md) | Node, client, fleet, repo layout, process model, ownership |
| [protocol.md](./protocol.md) | Pairing/auth, HTTP conventions, events, streams, errors, versioning |
| [data.md](./data.md) | Node core DB, per-plugin DBs, client cache, blobs, backups |
| [plugins.md](./plugins.md) | Plugin packages, contribution points, cross-plugin contracts, testing |
| [ui.md](./ui.md) | Shell parity, fleet surfaces, offline states, client/node state split |
| [security.md](./security.md) | Threat model, pairing/revocation, secrets, transport, at-rest |
| [plugin-inventory.md](./plugin-inventory.md) | All 20 plugins: what each does and its node/client/data split |
| [plan.md](./plan.md) | Phases with exit criteria and testing, migration and cutover |

## Vocabulary

- **Node** — the Electron-free service. Has a stable `nodeId` and owns its data root.
- **Client / Desktop** — the Electron app. Owns presentation state and per-node caches, nothing
  authoritative.
- **Fleet** — the set of nodes this client is paired with, plus the aggregate UI over them.
- **Workspace / Task** — same meaning as V1; both belong to exactly one node.
- **Plugin** — a workspace package under `plugins/` contributing node routes/services and client UI.
- **Pairing** — the one-time exchange that gives a client a device token for a node.
- **Device** — one paired client installation, as a node sees it. Full owner authority; revocable.
