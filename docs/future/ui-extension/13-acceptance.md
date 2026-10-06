# Phase 13: verify the combined UI programme

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phases 00 through 12 complete, with their package and host evidence recorded.

Verify that all extension points compose on both hosts and remain bounded across plugin, resource,
and Node transitions. This phase fixes integration defects within the delivered contracts; it adds
no further extension points. Documentation is the next and final phase.

## Owners and fixtures

Read [testing](../../testing.md), [agent drivers](../../local-development/agent-drivers.md),
[native overlay checks](../../testing/native-overlays.md), and [plugin testing](../../plugin-authoring/testing.md).
`apps/tui/src/extensions.test.tsx` exercises loaded extension composition.
`packages/client-core/src/host/tree/Slot.test.tsx` exercises owner/contributor behavior.
`packages/node-core/src/server/plugins/manifest.test.ts` checks loaded declarations.
`packages/create-acorn-plugin/index.test.ts` checks published authoring examples and package shape.

Use the loaded fixtures built by preceding phases, installed in isolated sessions. Include a client-only
tree contributor, an own-route descriptor provider, a capability-backed reader, and an optional overlay.
Do not add fixture packages to the production bundled plugin roster or depend on external accounts.

## Required matrix

Record these dimensions and actual results for each delivered point:

| Dimension | Required cases |
| --- | --- |
| Carrier | Loaded declaration and compiled contribution where supported. |
| Host | Desktop and terminal, with explicit unsupported frame/native behavior. |
| Arbitration | No match, one match, tie or stack overflow, saved pick, missing chosen provider. |
| Lifecycle | Disable, reload, bundle refusal, owner removal, navigation, resource/Node replacement. |
| Data | Empty, error, malformed, over-limit, Unicode, stale revision, late ignored response. |
| Interaction | Keyboard, pointer where available, Escape, outside dismissal, focus restoration. |
| Owner behavior | Source, copy, download, save, selection, approvals, navigation, and menus retained. |

The point list includes link previews, both transcript media points, workflow body, file/tab and
message/turn menus, loaded detail regions, file marks, selection actions, document services, fences,
Preview/Terminal toolbars, and source/pane annotations. Editor viewer checks are prerequisite regressions.

## Steps

1. Run `pnpm lint` and `pnpm test` with the root supported Node runtime and repository concurrency
   limits. Run `pnpm --filter @acorn/desktop test` for desktop/Rust integration. Expect exit zero.
   Do not run `turbo run test` directly. Classify baseline/environment failures with recorded output;
   do not hide them by weakening tests or changing unrelated source.
2. Pack/build the relevant published declaration/SDK/scaffold packages through their package scripts.
   Run package checks on an external loaded example with no private workspace imports. Verify its
   manifest passes Node parsing and device revalidation and its renderer entry names resolve.
3. Start `pnpm dev:agent -- --session ui-extension-acceptance`. Use the matching UI driver to obtain
   snapshots, invoke each contribution, and take screenshots. Refresh snapshots after navigation.
   Install and trust fixtures through the supported isolated-session workflow.
4. Start `pnpm dev:tui:agent -- --session ui-extension-acceptance --fixture tui-navigation`.
   Use the terminal UI driver to snapshot, press, and resize to 80 by 24 and 120 by 40. Exercise
   explicit preview/actions and each rendered contribution without assuming a pointer.
5. Run identity stress cases: two tasks with equal paths, two Nodes with equal plugin/resource IDs,
   disabled owners, a stale menu, and a delayed route response after navigation. No response or
   action from an obsolete identity may reach the replacement owner.
6. Measure workers and route calls for 100 links, 100 media cards, a large file tree, and multiple
   fences. Hidden links/cards start no contributor workers. Fences honor four active mounts per owner.
   Annotations make one request per contributor and distinct visible-key set. Rapid hover retains one
   open preview. Record measured counts and memory deltas; investigate growth after repeated disposal.
7. Perform native child-webview overlap and manual focus checks the driver cannot inspect. Verify the
   popover/menu remains visible and usable under the shipped platform fallback. State platform coverage.
8. Stop both sessions using their matching `dev:agent:ui` and `dev:tui:agent:ui` commands. Record the
   fixture versions, Node runtime, commands, screenshots, measurements, and unresolved checks.

## Completion and review

Complete only when the matrix passes, packed examples work, full lint/test gates pass, and any native
checks outside automation have recorded acceptance. Fix attributable integration failures and rerun
their affected gate before continuing. Missing required manual evidence remains an open acceptance item.

Review that file/media capabilities remain read-only, menu bodies contain only declared data,
cooperative trees remain one level, app trust is unchanged, and contributor failure leaves owner controls.
Do not implement a dynamic App hook or another network/browser authority to complete the matrix.

## Verify before building

- Recheck supported runtime, staged desktop binary ownership, and settled setup before tests.
- Recheck fixture installation and trust flows on the live release.
- Stop if a contract must change incompatibly; update its phase and get the owner decision before release.
