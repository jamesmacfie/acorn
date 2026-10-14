# Phase 4: make version skew visible and keep version 1 additive

Date: October 14, 2026. Status: proposed.

## Goal

A client and a Node running different builds behave predictably. The person can see both versions,
and a change that removes or renames a route can't merge silently while the protocol stays at
version 1.

## Starting point

- `NODE_PROTOCOL_VERSION` in `packages/protocol/src/device/node.ts` is 1.
  [Versioning](../../api-reference/transport.md#versioning) says that within a major, changes only
  add things.
- `nodeInfoSchema` in the same file carries the baseline and protocol number, not the Node's build
  version. A client can't tell a Node from September 30 from one built today.
- `apps/node/test/integration/routeRegistry.snapshot.json` lists every mounted route. The test
  accepts any change once the snapshot is rewritten. Between September 24 and October 14, 2026, 60
  routes left it and 184 joined. Some GitHub routes may have moved to lazy loading rather than
  disappeared, so 60 is an upper bound.
- `plugins/preview/src/client/configuredStore.ts` already handles a Node without one route, with a
  dated end. That's the pattern to copy where a client must outlive a Node.

## Changes

1. Add the Node's build version to `nodeInfoSchema` as an optional field. It's additive, so older
   clients ignore it.
2. Show it in Settings on the Nodes page beside the client's own version. When they differ, say so
   in one line, and mention that bundled plugins from a different build need trust again.
3. Make the route snapshot test fail when a route disappears, unless the change bumps
   `NODE_PROTOCOL_VERSION` or lists the route in a removal file next to the snapshot. Each line in that
   file names the route, the date, and the client release that stopped calling it. Additions stay
   free.
4. Write the rule into the versioning section: remove a route only after no supported client calls
   it, and record the removal.

## Decision for the owner

Acorn has no release tags, so "supported client" has no definition. Pick one before step 3 lands:

- Same build only. Refuse a Node whose build differs. This is the least work, but a remote Node can't
  upgrade on its own schedule, which the standalone distribution promises.
- A window, such as 30 days. Keep a route for that long after its last caller is gone. I recommend
  this. It matches the dated fallback the preview client already uses.

## Out of scope

A minor version or a feature handshake. The transport doc rules those out, and the removal file
covers the need.

## Acceptance

- Settings shows both versions, and a mismatch reads as a single warning, not an error state.
- Deleting a route without a removal line fails the route registry test with a message that names
  the route and the two ways forward.
