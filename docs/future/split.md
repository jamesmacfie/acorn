# Splitting the loaded plugins and the authoring toolkit into their own repos

Status: proposal, 2026-08-21; revised 2026-08-28. Nothing here has started. This records the repo
shapes, the extraction order, and the npm mechanics for moving the third-party-shaped plugins and the
publishable authoring surface out of this repository. The ecosystem gates in
[ecosystem/blockers.md](./ecosystem/blockers.md) still stand: this split moves our own packages out,
it is not the green light for running strangers' packages.

## Where things stand

Six plugins are in the loaded shape, each with an `acorn-plugin.config.mjs`: **rollbar, linear, http,
database, model-providers, and nodes-file**. The other packages under `plugins/` are compiled-tier,
import `@acorn/client-core` directly, and cannot leave until they migrate.

The six build against four surfaces:

- `@acorn/plugin-api/node`, the node half of the facade.
- `@acorn/plugin-api/ui`, the UI kit.
- `@acorn/plugin-api/ui/sdk`, the frame bridge (the same code as `acorn-plugin-sdk`).
- Deep type imports from `@acorn/protocol` (`api.ts`, `collections.ts`, `integrations.ts`, and
  friends).

None of that is published. `acorn-plugin-sdk` and `acorn-plugin-api/testkit` exist as packages, and
`create-acorn-plugin` scaffolds against them, but neither publishable package is on npm as of the
date above. The builder every plugin needs is `apps/node/scripts/build-plugin.mjs`, which inlines
everything except node builtins into the bundles.

http's direct `@acorn/node-core` imports, the leak the first version of this file named, are down to
two test files (`server/storage.test.ts`, `server/send.test.ts`). Production code goes through the
facade. Fix the tests before http moves; it no longer has to move last.

## The kit is not a repo

The first version of this file planned an `acorn-ui` repository: the Solid UI kit extracted from
`client-core/src/kit`, published, and depended on by the host. That plan is withdrawn, and the reason
is what the kit became.

The kit is **closed and host-owned** ([docs/ui-design.md](../ui-design.md) § The closed kit): a fixed node set
with semantic props, no `class` or `style`, a support matrix per host. A plugin does not import
components to render itself; it renders a tree of kit node names and the host mounts its own
components. What a plugin author installs is therefore the *types* of the kit and the remote
adapter, both of which are the SDK's business, not a component library's. Publishing the components
themselves would freeze the host's implementation as a public API for no consumer, which is the thing
a closed kit exists to avoid.

Two rules from the withdrawn plan survive in the SDK instead. `solid-js` stays a peer dependency of
anything that renders in the shell realm, because a second Solid instance is the hazard
`docs/plugins.md`'s dependency rules exist to prevent. And token definitions stay in acorn: the
theme and style axes, their disjoint-token tests, and the appearance bridge are host-owned; the kit
maps role tokens to them and a plugin names only roles.

## The repos

Three, not seven. A repo per plugin buys release plumbing for no benefit while we are the only
author.

### 1. `acorn-plugin-toolkit`: the publishable authoring surface

A small pnpm workspace holding everything a plugin author installs:

- `acorn-plugin-sdk`: the bridge (`connect`, `mountFrame`, `mountTree` with the Solid remote
  adapter). Ready to publish as it stands today.
- `create-acorn-plugin`: the scaffold, ready as it stands.
- `acorn-plugin-api`: the published form of the facade. Two real problems live here, solved as
  follows:
  - **The node half is runtime, not only types.** `@acorn/plugin-api/node` re-exports working code
    from node-core: `viaBridge`, `requireUser`, `respondError`, the git helpers. The builder already
    inlines everything into plugin bundles, so the honest publish is a **built dist that snapshots
    those modules**, versioned against `PLUGIN_API_MAJOR`. Extracting them from node-core and
    inverting that dependency is much bigger surgery for the same bundle output. Take the snapshot.
  - **Deep protocol imports.** Plugins import `@acorn/protocol/api.ts` as raw TypeScript, which a
    published package cannot serve. Publish protocol with a proper exports map (it is small, one
    zod dependency) rather than folding its types into plugin-api.
  - **The kit's types and the remote adapter.** `@acorn/plugin-api/ui` publishes node prop types,
    the role token enums, and the adapter; it publishes no component implementation.
- `acorn-plugin-build`: `build-plugin.mjs` extracted into a CLI, since an out-of-repo plugin has no
  `apps/node/scripts` to reach into. `create-acorn-plugin`'s template calls it.
- The testkit, published so plugin tests keep running outside the workspace.

### 2. `acorn-plugins`: one monorepo for the loaded plugins

Rollbar, linear, http, database, model-providers, and nodes-file share one build, one CI, and one
version train against the plugin API major. Split a plugin into its own repo later if it grows
outside contributors; do not start there.

These publish **artifacts, not libraries**: the built `acorn-plugin.json` plus node and client
bundles, as npm packages or GitHub release tarballs. The desktop build then seeds bundled plugins by
pulling those artifacts at package time instead of building workspace siblings.

### 3. `acorn`: the host keeps everything else

The compiled-tier plugins, the shells, core, the kit, and the token system stay. After the split,
acorn pulls plugin artifacts at desktop package time and depends on nothing from the toolkit repo
except as a dev dependency for the compatibility test below.

Carry history into each new repo with `git filter-repo --path plugins/<id> ...` on a fresh clone, one
run per destination repo.

## npm mechanics

**Naming.** The `acorn` npm name belongs to the JS parser, and the shipped front door already chose
unscoped names (`acorn-plugin-sdk`, `create-acorn-plugin`). Stay unscoped for consistency:
`acorn-plugin-api`, `acorn-plugin-build`. If a scope is wanted instead, register an npm org (the bare
`@acorn` scope is likely contested) and set `publishConfig.access: "public"` in every package; do not
mix scoped and unscoped.

**Publishing.**

1. Create the npm account or org, and add the package names before announcing anything.
2. Use trusted publishing: npm's OIDC integration with GitHub Actions, so release workflows publish
   without a long-lived token. Add `--provenance`.
3. Use changesets (or release-please) per repo for versioning.
4. Pin the majors of `acorn-plugin-api` and `acorn-plugin-sdk` to `PLUGIN_API_MAJOR` (currently `4`),
   so the host's compatibility refusal and the npm semver line are the same fact.
   `docs/plugins.md § What is published` holds the compatibility promise; the published packages make
   it enforceable.
5. `packages/plugin-sdk/package.json` already has the right publish shape (`prepack` builds,
   `files: ["dist"]`, a types entry). Copy that pattern.

## Order of operations

1. **Publish `acorn-plugin-sdk` and `create-acorn-plugin` as they stand.** Zero extraction needed,
   and it proves the release pipeline end to end.
2. **Build the publishable `acorn-plugin-api` dist and the protocol package.**
3. **Move linear out as the pilot.** It exercises every contribution kind. Teach the desktop build to
   seed from its published artifact, then move rollbar, model-providers, nodes-file, and database.
4. **Fix http's two test imports, then move it.**

One sequencing worry is settled: the SDK is tree-shaped already, and every loaded plugin draws a
tree, so the first published artifacts are trees rather than a frame-shaped SDK republished under the
same major a release later.

## Known hazards, from our own records

- **Bundled-plugin seeding does not reconcile updates.** The desktop marks dev copies as "user" and
  the reconciler will not rebuild them, so the npm-update path needs the seeding work from the
  rollbar migration extended to version bumps. Without it, publishing a new plugin version does
  nothing on machines that already have the old one.
- **Containment still gates a marketplace.** The node half of a loaded plugin is disclosed, not
  contained (`docs/security.md § The containment ladder`). Moving first-party plugins to npm changes
  where our code lives, not who we trust; discovery of third-party packages stays behind rung 2.
- **The stale-package trap gets worse at a distance.** A host change that needs a new
  plugin-declared field already requires rebuilding every plugin package in-repo; across repos it
  additionally requires a publish and a seed. Budget a compatibility test in acorn's CI that loads
  the published artifacts against the current host.
