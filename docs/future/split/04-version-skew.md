# Phase 4: make version skew visible and keep version 1 additive

## Completion note

Landed October 15, 2026.

What changed:

- `scripts/buildVersion.mts` stamps each bundle with the date and hash of the commit it was built
  from, such as `2026-10-15 cde782f12e98`. The Node, desktop renderer, and terminal Vite configs pass
  it to `define` as `__ACORN_BUILD__`. `ACORN_BUILD` in `packages/protocol/src/device/node.ts` reads
  it, and reads `development` where nothing stamped the code, as under `pnpm dev:node` and Vitest.
- `nodeInfoSchema` has an optional `buildVersion`. `GET /v1/node` sends it to an authenticated caller
  only, beside `nodeId`.
- Settings → Nodes fetches each Node's build through `createNodeBuilds()` in
  `packages/client-core/src/infra/node/nodeBuild.ts`, a fan-out like the attachments. A row with the
  same build reads "Build X, the same as this app." Two different stamps, or a Node from before this
  change, get one amber warning that names both and says the Node's bundled plugins will ask for
  trust again. When either side runs from source and reports `development`, the row shows a plain line
  naming both instead. `compareBuild` in the same file makes that choice, and its test covers each
  case.
- `routeRegistry.snapshot.json` covers every `/v1` route, core and compiled plugins, and records the
  protocol version it was written under. `routeRegistry.test.ts` fails when a route in it is gone
  without a line in `routeRegistry.removals.txt`, unless `NODE_PROTOCOL_VERSION` changed. The message
  names the routes and both ways forward. Regenerating the snapshot keeps an unrecorded removal, so
  regenerating can't hide one. A second test fails a malformed line, or one whose removal date is
  less than 90 days after the client build it names.
- The versioning rules moved out of `transport.md` into [Versioning](../../api-reference/versioning.md),
  with every citation and link updated and an entry in `docs/README.md`. Its
  [Removing a route](../../api-reference/versioning.md#removing-a-route) holds the rule, and the last
  bullet of **Mixed builds** describes the build line. The golden-list docs say the snapshot covers
  core routes too.
- The unread `APP_VERSION` binding is gone, with its option on `makeBindings`, its parameter on
  `makeRuntime`, and the test fixtures that set it. The boot option `appVersion` stays, because the
  telemetry release name reads it.

Decisions and deviations:

- The owner settled the window on October 15, 2026: routes use the 90-day window from **Mixed
  builds**, so the API has one number. The owner first chose 30 days and then moved it to 90 to close
  the gap between the two rules. The route rule points at **Mixed builds** rather than restating the
  number.
- The build is the commit, not the package version, because every package says 1.0.0. The hash is
  fixed at 12 characters, so two checkouts of one commit stamp the same string. Uncommitted changes
  don't change the stamp.
- The build is authenticated-only, so an unpaired caller can't read which build to target. The
  pairing probe doesn't show it.
- The snapshot grew from plugin routes to all `/v1` routes, because a core route removal was silent
  before. The hand-written `MOUNTED_CORE_ROUTES` list went, since the snapshot covers it. The
  pre-existing red in this test was seven added agents and git routes, and the regenerated snapshot
  includes them.
- The removal file is plain text: `<METHOD> <path> <removed on> <client build date> <commit>`.

Checked by hand with `pnpm dev:remote -- --session p4-skew1`. An empty commit added after the pack
gave the window a different build from the container Node. The local row read "Build 2026-10-15
ba001d8ccfb1, the same as this app." The Container Node row showed one amber warning naming
`cde782f12e98` and `ba001d8ccfb1`. An unauthenticated `GET /v1/node` on the container had no
`buildVersion`. With a fake route added to the snapshot, the test failed naming it, regeneration kept
it, a line 26 days after its client build failed, and a line far enough apart passed. The window was
30 days during that check and is 90 since, with the test's constant the only change. The Node service
graph was 1,821,335 bytes against the 1,822,300 ceiling. The plain line for a source build is covered
by the unit test, not checked in a window.

For later phases:

- Routes behind a lazy mount, such as GitHub's mirror, aren't in the snapshot.
  `mirrorRoutes.test.ts` notices one going missing, but has no removal rule.
- Pre-existing reds still there: four arch tests (client console baseline, the policyGate and
  remote-node doc citations, two docs over 200 lines, two doc paths) and `pluginDisable.test.ts`.

Date: October 14, 2026. Status: landed October 15, 2026.

## Goal

A client and a Node running different builds behave predictably. The person can see both versions,
and a change that removes or renames a route can't merge silently while the protocol stays at
version 1.

## Starting point

- `NODE_PROTOCOL_VERSION` in `packages/protocol/src/device/node.ts` is 1.
  [Versioning](../../api-reference/versioning.md) says that within a major, changes only
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

Acorn has no release tags, so "supported client" had no definition. The two options were:

- Same build only. Refuse a Node whose build differs. This is the least work, but a remote Node can't
  upgrade on its own schedule, which the standalone distribution promises.
- A window, such as 30 days. Keep a route for that long after its last caller is gone.

Settled October 15, 2026: a window, and the same one as mixed builds. A supported client is one built
within the 90 days that **Mixed builds** allows. A route stays for 90 days after the first client
build that no longer calls it, then goes with a dated line in the removal file.

## Out of scope

A minor version or a feature handshake. The versioning doc rules those out, and the removal file
covers the need.

## Acceptance

- Settings shows both versions, and a mismatch reads as a single warning, not an error state.
- Deleting a route without a removal line fails the route registry test with a message that names
  the route and the two ways forward.
