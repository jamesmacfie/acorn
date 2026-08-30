# Isolation: loaded plugins in a terminal

## The hard problem, unchanged

A terminal has no iframe. Plugin code cannot run in the TUI's own process without creating a third
trust tier that wears the frame tier's enforced-permission claims with the node half's disclosed-only
weakness. The desktop's sandbox for a tree-emitting plugin is a Web Worker under a CSP with no
network (`docs/security.md § The containment ladder`, rung 0). The terminal's is a Node worker thread
or child process under real permission flags, speaking the same bridge and tree protocols over a
`MessagePort`, with the broker and `scopes.ts` staying host-side. Same allowlist, different transport;
the realm moves, the choke point does not.

## The sandbox

`node:worker_threads`, started with `--permission` and no filesystem or network grants, loading the
plugin's content-addressed bundle from the TUI's cache by path. The worker receives two ports in one
handshake, exactly as the DOM worker does (`packages/client-core/src/plugins/tree/workerHost.ts`): the
bridge port carrying the SDK verbs and the three host pushes, and the tree port carrying `tree:mount`,
`tree:batch`, and the rest.

`workerHost.ts` already has the seam: `_setWorkerFactory` exists so a test can substitute the worker
constructor, and the TUI substitutes a `worker_threads` factory the same way. Everything else in that
file, slot bookkeeping, the 30-second grace, the heartbeat, the fail-fanout, is shared. The tree host's
batch validation (`acceptable()`) and mutation application (`apply()`) in `TreeHost.tsx` are pure map
arithmetic over the protocol and are shared too; what the TUI replaces is the rendering shell around
them and the `requestAnimationFrame` coalescer, which becomes the renderer's tick.

If `--permission` proves too coarse (it is process-wide, and a worker thread inherits it), the fallback
is a child process per plugin under the same flags, with the two ports carried over an IPC channel.
The protocol does not care. Phase 5 decides after measuring, and records the answer.

## This is rung 2

`docs/security.md § The containment ladder` names rung 2 as node-half containment: plugin code out of
process, the context becoming authorised calls rather than an object. The terminal's sandbox is that
object, built for a different half. Phase 5 designs the two together: the worker factory, the
permission flags, and the "context as calls over a port" shape are written once and used by the TUI
first, so when the node half moves out of process it inherits a tested design rather than inventing
one. `docs/future/ecosystem/blockers.md` lists rung 2 as a gate for third-party plugins; this is the
down payment.

## Custody

A terminal client pairing with a node and receiving a bundle needs the same bytes-hash trust store the
desktop has, but there is no desktop helper to do the hashing and hold custody. The TUI is shell and
broker at once. So the TUI implements `PluginCustody` (the `plugins` group of the platform seam, four
members: `state`, `cachePut`, `trustRecord`, `devGrant`) over files:

- A content-addressed cache directory under the TUI's config root, one file per bundle named by
  hash. Bytes are hashed on arrival; a mismatch is refused and never re-keyed, the desktop's rule.
- An acknowledgement file beside it, keyed `(pluginId, hash)`, holding the per-device consent the
  desktop keeps in its trust store. Same schemas from `@acorn/protocol`; no custody type is defined in
  the TUI package.
- Device provenance is natural and `{ path }` is an allowed source form: a person at a terminal
  installing a plugin is installing it here. `docs/future/client-plugins/03-device-provenance.md`'s
  resolution rule (device wins) applies unchanged.

No module outside `packages/client-core/src/plugins/host.ts` calls `pluginCustody()`. That is the
rule the file states as its own reason for existing, and the TUI does not add a second caller.

## The trust prompt

The prompt's three tiers and the permission-key diff are drawn from `trustModel.ts` lines, and those
are data. On the TUI the prompt is a kit tree in a `Modal`: the same sentences, the same "accept,
refuse, show me" actions, drawn where the pane would go. A plugin cannot draw over it because a plugin
draws inside a slot and the modal owns the key layer. Nothing in the prompt is terminal-specific.

## The third column

`docs/security.md § Trust boundaries` lists four processes: renderer, desktop shell and helper, node,
node child. The TUI collapses the first two. Phase 5 adds the terminal to that section and to
`§ Transport and auth`, `§ Third-party plugin bundles`, `§ The containment ladder`, and the summary
table, saying in each:

| Section | Desktop | Terminal |
| --- | --- | --- |
| Trust boundaries | Renderer and helper are two processes; the renderer never holds a token. | One process. The token lives in the broker module and never reaches a kit component or a plugin worker. A module boundary, held by the arch test, where the desktop has a process boundary. |
| Transport and auth | Helper pins the certificate and sets the bearer on the WebSocket upgrade. | The TUI does both natively. Equal to the desktop; easier than the web. |
| Plugin bundles | Helper hashes bytes into a content-addressed cache; consent per device per bundle. | The TUI hashes bytes into a file cache; consent in an acknowledgement file. Same schemas, same keys, `{ path }` allowed. |
| Containment ladder, rung 0 | iframe for pixels, Web Worker for trees, `connect-src 'none'`, a `MessagePort` the only way out. | No pixels, so no iframe. A `worker_threads` worker (or child process) under `--permission`, the same two ports the only way out. |
| Summary table | fifteen rows | One row added: the TUI's device token file, exposure "a process on this machine with the user's uid", mitigation "0600, same as the node's own keys". |

The terminal sits between desktop and web on the trust ladder: it holds the token in the same process
as the UI, which the desktop does not, and it holds it in a file with real modes, which the web
cannot.
