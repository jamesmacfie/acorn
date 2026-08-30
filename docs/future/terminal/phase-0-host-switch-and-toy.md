# Phase 0: the host switch and the toy

Status: not started. Waits on nothing.

## Goal

The http and linear panes, unchanged, drawn in a terminal against a running `dev:node`. One pane at a
time, one hardcoded task, no chrome. A screenshot that proves the kit is intent and not layout, or a
list of the places it is not.

## Why this phase, and why now

Every later phase assumes the kit renders honestly on a host with no pixels. That assumption is held
today by tests that check a column is filled in. Two panes on a real terminal is the cheapest way to
find out, and it is worth finding out before more panes are written against the kit. This is a spike:
the code is allowed to be ugly and half of it will be replaced in phases 1 and 2. What survives is the
list of kit dishonesties, fixed in `docs/ui-design.md`'s owning sections, for every host.

## Scope

In:

- `HOST` in `packages/client-core/src/kit/tokens/support.ts` supplied per host package at build time.
  The desktop says `dom`. The TUI says `tui`.
- `apps/tui/` (new), a workspace package with one entry that sets `globalThis.acorn` from Node,
  imports client-core, and mounts one pane through OpenTUI's Solid reconciler.
- A `transport` implementation over `NodeBroker` from `packages/desktop-helper/src/broker/nodeBroker.ts`,
  imported directly, authenticated with a device token from an env var. No fleet, no pairing, no
  custody: the other seam groups are null.
- A file-backed persister behind the per-node query cache in `packages/client-core/src/infra/node/fleet.ts`,
  chosen when `idb-keyval` has no IndexedDB to talk to.
- A host check in front of the `document.documentElement` writes in
  `packages/client-core/src/infra/persistence/appStartup.ts`.
- OpenTUI components for the nodes `list-detail` and `header-body-footer` need for these two panes:
  `Stack`, `Inline`, `Section`, `Text`, `Heading`, `Rows`, `Row`, `Badge`, `Button`, `Field`,
  `Toolbar`, `Alert`, `ListDetail`, `ListColumn`, `DetailColumn`, `Tabs`, `TabPanel`, and the
  `Markdown` reduction. About fifteen, done to the sentence in `docs/ui-design.md § Every node at 80
  by 24` and no further.
- The `list-detail` and `header-body-footer` layouts, minimally: two columns, a key to switch.
- The DOM keymap adapter swapped for `createDefaultOpenTuiKeymap`, with `next`, `prev`, `activate`,
  `dismiss` working in a collection. Nothing else.

Out: every other node and layout, chrome, the process model (the node is started by hand), loaded
plugins, tests beyond one smoke test, persistence of anything across runs.

## Design detail

**Boot.** `apps/tui/src/main.ts` (new): construct the broker with the endpoint, fingerprint, and token
from env; assign `globalThis.acorn` an object with `transport` and nothing else; import client-core's
boot (`selectActiveNode`, `applyNodePlugins`, the watchers) from the same modules the desktop's
`index.tsx` uses; render with `@opentui/solid`'s `render` instead of `solid-js/web`'s. The pane is
chosen by a flag: `--pane http` or `--pane linear`.

**The two panes.** Both are compiled in-process today and both also ship tree bundles
(`plugins/http/src/tree/index.tsx`, `plugins/linear/src/tree/index.tsx`). Phase 0 uses the compiled
path, because the decision is that first-party panes run in-process. The tree path is phase 5's.

**The kit table.** `apps/tui/src/kit/components.ts` (new), typed `Partial<Record<KitNodeName,
Component>>` in this phase only. A node with no entry draws the placeholder with its name, so the
screenshot shows what is missing rather than crashing.

**What to look for.** A node that had to read the terminal width. A node whose sentence could not be
drawn without a prop the kit does not carry. A layout whose projection was wrong. A key that did not
map to an intent. Each one is a finding against the kit, filed in `docs/ui-design.md`, not a
workaround in `apps/tui/`.

## Code touched

- `packages/client-core/src/kit/tokens/support.ts`: `HOST` from a build-time define.
- `packages/client-core/src/infra/node/fleet.ts`: persister chosen by capability.
- `packages/client-core/src/infra/persistence/appStartup.ts`: host check.
- `packages/client-core/src/host/keys/install.ts`, `kit/keys/keymapHost.ts`: accept either adapter's types.
- `apps/tui/` (new): `package.json`, `src/main.ts`, `src/kit/components.ts`, `src/layouts/`.
- `pnpm-workspace.yaml`: no change, `apps/*` is already a workspace glob.

## Tests

- One smoke test in `apps/tui/`: boot against a stubbed transport, mount the http pane with a fixture
  request list, assert the cell buffer contains the request names and the method badges. OpenTUI's
  renderer has a test mode that renders to a buffer without a TTY.
- `support.test.ts` and `roles.test.ts` keep passing. `HOST` being configurable must not let the
  desktop build say anything but `dom`; one assertion in `apps/desktop`'s tests pins it.

## Docs owed

- `docs/ui-design.md § The closed kit`: `HOST` is per host, and which hosts exist.
- Any kit finding: the owning section of `docs/ui-design.md`, the same change.
- This folder's README: the phase table row says shipped and links the findings list.

## Doors left open

- The tree path in the TUI: `_setWorkerFactory` untouched, phase 5.
- The process model: the node is started by hand, phase 3.
- Every node not in the list above draws a placeholder, phase 1.

## Done when

Someone who has never seen the TUI runs `pnpm --filter @acorn/tui dev -- --pane http` against a
running `dev:node`, sees the request list and a request's detail, moves with `j`/`k`, opens one with
Enter, and can read it at 80 by 24. The findings list exists, even if empty.

## Verify before building

- `packages/client-core/src/kit/tokens/support.ts` still exports `HOST` and only `Only` and `Fallback`
  read it.
- `packages/desktop-helper/src/broker/nodeBroker.ts` still has no shell binding and still sets the
  bearer on the upgrade header.
- `packages/client-core/src/infra/node/fleet.ts` still imports `idb-keyval` in one place.
- `@opentui/keymap/opentui` still exports `createDefaultOpenTuiKeymap`; `@opentui/solid` is
  published at the version the keymap pins.
- `plugins/http` and `plugins/linear` still declare `list-detail` and `header-body-footer`.
