# Phase 11: add Preview and Terminal toolbar contributions

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 10. Keep native-page and PTY authority owned by their plugins.

Let plugins add bounded controls around Preview and Terminal, with metadata props and narrowly
declared owner actions. A toolbar contribution does not gain page contents, terminal output, or input access.

## Starting point and owners

`plugins/preview/src/client/PreviewPane.tsx` draws navigation controls around `Rectangle kind="webview"`.
`plugins/terminal/src/client/TerminalPanel.tsx` draws `DocumentTabs`, profiles, Interrupt, and hide controls.
`packages/client-core/src/host/tree/Slot.tsx` binds declared actions per mount.
`packages/plugin-sdk/src/public.ts` publishes `TreeMount.host.invoke` and overlay behavior.
`packages/client-core/src/infra/platform/nativePages.ts` handles host overlay geometry.

Read [remote owner actions](../../plugins/remote-points.md#asking-the-owner),
[host webviews](../../shell/webviews.md), and [terminal sessions](../../terminal/sessions.md).

## Contract

Preview owns `preview:toolbar-actions`, `remote`, `stack`, `max: 4`.
Props are `{ taskId, projectId?, url?, loading, canGoBack, canGoForward }` from the owner view.
Declare only `reload` as an owner action in this phase. Payload `{ expectedUrl }` must match the
active owner URL and task. The handler uses Preview's own control, not a contributor-created webview.

Terminal owns `terminal:toolbar-actions`, `remote`, `stack`, `max: 4`.
Props are `{ taskId, projectId?, session?: { id, title, running } }` for the selected terminal.
Declare only `interrupt`, with `{ expectedSessionId }`. Refuse if selected session, task, or running
state changed. Do not expose stdin, output buffers, environment, command history, or process APIs.

Both actions require a person's press/key invocation in the originating tree. Add a mount-bound
interaction check for these action handlers if `host.invoke` alone does not supply it. Bind identity
again before acting; focus or a stale expected ID cannot authorize another task's operation.
Compiled contributors follow the same owner policy. Core owner controls remain outside the slots.

## Steps

1. Add typed owner props/actions beside each plugin and declare the points in their client registrations.
   Use composer actions and Changes push actions as stack precedents.
2. Place each slot beside the owner's controls. Preserve toolbar overflow, document tabs, shortcut
   claims, PTY focus, Preview address editing, and native rectangle sizing.
3. Implement narrow action handlers and recheck active owner identity. Surface unsupported/changed
   target failures through the contributor's interaction without interrupting the owner view.
4. Add loaded fixtures with a Reload button and an Interrupt button, using `props.host.invoke`.
   Demonstrate own overlay support without giving access to native page or PTY content.
5. Render Terminal toolbar contributions in the terminal client. Where Preview has no usable native
   page, expose a declared unsupported state and do not offer a falsely working reload action.

## Tests and acceptance

Extend `PreviewPane.test.tsx`, `TerminalPanel.test.tsx`, Slot action tests, and terminal host tests.
Cover four-plus contributors, vanished sessions, changed URL/task/Node, synthetic invocation without
person interaction, disabled registrations, owner buttons, PTY focus, and native-page overlap.
Verify a contributor cannot interrupt a supplied different session ID or request arbitrary navigation.

Run `pnpm lint`, full suites for `@acorn/plugin-preview`, `@acorn/plugin-terminal`,
`@acorn/client-core`, `@acorn/tui`, affected protocol/SDK packages, and architecture. Expect exit zero.
In the desktop, exercise buttons beside a live native page and terminal. In the terminal, check the
Terminal controls and Preview's honest host support. Record inaccessible native-view checks separately.

Complete when additions use one bounded stack per owner, person actions remain scoped, and none of
the contributor bridges has acquired native browsing or terminal execution authority.

## Verify before building

- Recheck action interaction proof and the selected session/URL lifetime.
- Recheck toolbar size and native overlay constraints in the running host.
- Stop if a contributor needs page inspection or PTY input; that is a separate capability, not a toolbar prop.
