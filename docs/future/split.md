# Splitting the loaded plugins and the UI kit into their own repos

Status: proposal, 2026-08-21. Nothing here has started. This records the repo shapes, the
extraction order, and the npm mechanics for moving the third-party-shaped plugins and the shared
Solid UI kit out of this repository. The ecosystem gates in
[docs/future/ecosystem/blockers.md](./ecosystem/blockers.md) still stand: this split moves our own
packages out, it is not the green light for running strangers' packages.

## Where things stand

Five plugins are in the loaded shape, each with an `acorn-plugin.config.mjs`: **rollbar, linear,
http, database, and model-providers**. The other packages under `plugins/` are compiled-tier, import
`@acorn/client-core` directly, and cannot leave until they migrate.

The five build against exactly four surfaces:

- `@acorn/plugin-api/node`, the node half of the facade.
- `@acorn/plugin-api/ui`, the Solid UI kit.
- `@acorn/plugin-api/ui/sdk`, the frame bridge (the same code as `acorn-plugin-sdk`).
- Deep type imports from `@acorn/protocol` (`api.ts`, `collections.ts`, `integrations.ts`, and
  friends).

None of that is published. `acorn-plugin-sdk` and `acorn-plugin-api/testkit` exist as packages, and
`create-acorn-plugin` scaffolds against them, but neither publishable package is on npm as of the
date above. The builder every plugin needs is `apps/node/scripts/build-plugin.mjs`, which inlines
everything except node builtins into the bundles.

One known leak: **http imports `@acorn/node-core` directly from its src**, past the facade
(`activeIdentity.ts`, `core/index.ts`, `core/secrets.ts`, `server/db/index.ts`). That must be fixed
before http can move, and it moves last for that reason.

## The repos

Four, not eight. A repo per plugin buys five sets of release plumbing for no benefit while we are
the only author.

### 1. `acorn-ui` — the shared Solid UI kit

`@acorn/plugin-api/ui` is a re-export barrel over `client-core/src/ui`; the components and their
CSS physically live in the host. [docs/plugins.md § Frame authoring and the UI kit](../plugins.md)
already promises this move: "the UI kit will be published separately for external plugins later,
and only that import name is expected to change."

Extraction inverts the dependency: the components and their CSS move to the new package, and
client-core depends on it. Two rules the extraction must keep:

- **`solid-js` is a peerDependency, never a dependency.** A second Solid instance in the shell
  realm is the exact hazard the dependency rules in docs/plugins.md exist to prevent.
- **Token definitions stay in acorn.** The theme and style axes, their disjoint-token tests, and
  the appearance bridge are host-owned. The kit ships components that consume the token contract
  and documents which tokens it reads; the host keeps applying them, including into frame documents
  via `/ui.css`.

The surface stays the pruned one `plugin-api/src/ui/index.ts` holds today (primitives, Picker,
Modal, the diff toolkit on its own subpath). Page-level components stay off the contract for the
reason recorded in that file: a design system on a contract stops being able to change.

### 2. `acorn-plugin-toolkit` — the publishable authoring surface

A small pnpm workspace holding everything a plugin author installs:

- `acorn-plugin-sdk` — the frame bridge, ready to publish as it stands.
- `create-acorn-plugin` — the scaffold, ready as it stands.
- `acorn-plugin-api` — the published form of the facade. Two real problems live here, solved as
  follows:
  - **The node half is runtime, not just types.** `@acorn/plugin-api/node` re-exports working code
    from node-core: `viaBridge`, `requireUser`, `respondError`, the git helpers. Since the builder
    already inlines everything into plugin bundles, the honest publish is a **built dist that
    snapshots those modules**, versioned against `PLUGIN_API_MAJOR`. The alternative, extracting
    those modules out of node-core and inverting that dependency too, is much bigger surgery for
    the same bundle output. Take the snapshot.
  - **Deep protocol imports.** Plugins import `@acorn/protocol/api.ts` as raw TypeScript, which a
    published package cannot serve. Publish protocol with a proper exports map (it is small, one
    zod dependency) rather than folding its types into plugin-api; the protocol package is the
    contract's natural home.
- `acorn-plugin-build` — `build-plugin.mjs` extracted into a CLI, since an out-of-repo plugin has
  no `apps/node/scripts` to reach into. `create-acorn-plugin`'s template calls it.
- The testkit, published so plugin tests keep running outside the workspace.

### 3. `acorn-plugins` — one monorepo for the five loaded plugins

Rollbar, linear, http, database, and model-providers share one build, one CI, and one version train
against the plugin API major. Split a plugin into its own repo later if it grows outside
contributors; do not start there.

These publish **artifacts, not libraries**: the built `acorn-plugin.json` plus node and client
bundles, as npm packages or GitHub release tarballs. The desktop build then seeds bundled plugins
by pulling those artifacts at package time instead of building workspace siblings.

### 4. `acorn` — the host keeps everything else

The compiled-tier plugins, the shells, core, and the token system stay. After the split, acorn
depends on `acorn-ui` from npm and pulls plugin artifacts at desktop package time.

Carry history into each new repo with `git filter-repo --path plugins/<id> ...` on a fresh clone,
one run per destination repo.

## npm mechanics

**Naming.** The `acorn` npm name belongs to the JS parser, and the shipped front door already chose
unscoped names (`acorn-plugin-sdk`, `create-acorn-plugin`). Stay unscoped for consistency:
`acorn-ui`, `acorn-plugin-api`, `acorn-plugin-build`. If a scope is wanted instead, register an npm
org (the bare `@acorn` scope is likely contested) and set `publishConfig.access: "public"` in every
package; do not mix scoped and unscoped.

**Publishing.**

1. Create the npm account or org, and add the package names before announcing anything.
2. Use trusted publishing: npm's OIDC integration with GitHub Actions, so release workflows publish
   without a long-lived token. Add `--provenance`.
3. Use changesets (or release-please) per repo for versioning.
4. Pin the majors of `acorn-plugin-api` and `acorn-plugin-sdk` to `PLUGIN_API_MAJOR`, so the host's
   compatibility refusal and the npm semver line are the same fact. `docs/plugins.md § What is
   published` holds the compatibility promise; the published packages make it enforceable.
5. `packages/plugin-sdk/package.json` already has the right publish shape (`prepack` builds,
   `files: ["dist"]`, a types entry). Copy that pattern.

## Order of operations

1. **Publish `acorn-plugin-sdk` and `create-acorn-plugin` as they stand.** Zero extraction needed,
   and it proves the release pipeline end to end.
2. **Extract the UI kit into `packages/ui` inside acorn first.** Flip the imports, let CI settle,
   then split the repo out. Extracting and relocating in one move makes every failure ambiguous.
3. **Build the publishable `acorn-plugin-api` dist and the protocol package.**
4. **Move linear out as the pilot.** It exercises every contribution kind. Teach the desktop build
   to seed from its published artifact, then move rollbar, model-providers, and database.
5. **Fix http's direct node-core imports, then move it last.**

## Known hazards, from our own records

- **Bundled-plugin seeding does not reconcile updates.** The desktop marks dev copies as "user" and
  the reconciler will not rebuild them, so the npm-update path needs the seeding work from the
  rollbar migration extended to version bumps. Without it, publishing a new plugin version does
  nothing on machines that already have the old one.
- **Containment still gates a marketplace.** The node half of a loaded plugin is disclosed, not
  contained (docs/security.md). Moving first-party plugins to npm changes where our code lives, not
  who we trust; discovery of third-party packages stays behind the containment ladder.
- **The stale-package trap gets worse at a distance.** A host change that needs a new
  plugin-declared field already requires rebuilding every plugin package in-repo; across repos it
  additionally requires a publish and a seed. Budget a compatibility test in acorn's CI that loads
  the published artifacts against the current host.
