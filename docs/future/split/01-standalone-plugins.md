# Phase 1: ship the loaded plugins with the standalone Node

Date: October 14, 2026. Status: proposed.

## Goal

A Node installed from the `pnpm pack:node` tarball runs the same seven loaded plugins as the Node the
desktop supervises: agent-cost, database, HTTP, Linear, model providers, Rollbar, and Sentry
telemetry. Today a remote Node starts without them, and the owner has to know to install each one.

## Starting point

- `apps/desktop/scripts/build-bundled-plugins.mjs` holds the roster in `BUNDLED_PLUGINS` and builds
  each package into the desktop's `dist/bundled-plugins` folder.
- The desktop passes that folder to its Node, and `bootNode` in `apps/node/src/composition/boot.ts`
  reconciles it into the data root.
- `scripts/pack-node.mjs` stages the Node, CLI, and terminal bundles and every migration chain. It
  stages no plugin packages.
- `apps/node/src/entries/standalone.ts` reconciles only when `ACORN_BUNDLED_PLUGINS_DIR` is set.
- `docs/node-distribution.md` says a standalone Node supports the database plugin and HTTP, then says
  plugins arrive only through an install. Both can't be true.

## Changes

1. Move the roster out of the desktop script into one module under `scripts/`, and have both the
   desktop build and the packer read it. Two lists would drift.
2. Have `scripts/pack-node.mjs` build the roster into a `plugins` folder inside the tarball.
3. In `apps/node/src/entries/standalone.ts`, when `ACORN_BUNDLED_PLUGINS_DIR` is unset and the Node
   runs from an unpacked tarball, use that `plugins` folder. Keep the variable as the override. Keep
   `pnpm dev:node` as it is, so a developer's `build:plugin` copy isn't replaced.
4. Rewrite the **Plugins** section of `docs/node-distribution.md` to describe one behavior.

## Out of scope

Publishing loaded plugins to npm or GitHub, which belongs to [split.md](../split.md). Changing which
plugins are bundled.

## Acceptance

- Unpack a fresh tarball, start it with an empty data root, and pair the desktop. Settings lists all
  seven loaded plugins as installed and active on that Node.
- Uninstall one on the standalone Node and restart it. The uninstall marker wins, as it does on the
  desktop.
- The packer fails with a clear message when a roster entry fails to build.

## Risks

The desktop trusts its own bundled client halves by hash
(`packages/custody/src/plugins/bundledPluginTrust.ts`). A remote Node built from a different version
offers different bytes, so the person sees a trust prompt. That's correct behavior, but phase 4's
version display should explain it.
