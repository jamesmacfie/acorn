# Phase 11: add Preview and Terminal toolbar contributions

Status: done, October 10, 2026. Branch `phase-11-toolbar-actions`, from `7522b3b0d`.

## Completion note

Other plugins can put up to four controls in Preview's address bar and beside the terminal's own
controls. Preview offers one action, `reload`, and Terminal one, `interrupt`. Each runs only after a
person's press inside the contributor's own tree, and only on the page or session the contributor
named. No contributor gets page contents, navigation, PTY input or output, or a process handle.

### What landed

- **Contracts.** `plugins/preview/src/contract/toolbarActions.ts` and
  `plugins/terminal/src/contract/toolbarActions.ts` hold each point's name, props, payload, and result.
  Terminal's also holds `interruptRefusal`, the check both of its hosts run.
- **Points.** `preview:toolbar-actions` and `terminal:toolbar-actions`, both `remote`, `stack`,
  `max: 4`, registered in each plugin's `client/index.ts` with `actions: ['reload']` and
  `['interrupt']`.
- **Person check.** Every owner action handler gets a second argument, `{ byPerson }`.
  `hostRequests.ts` has `createGestureClock`, a per-mount record of trusted `pointerdown` and `keydown`
  events, and `GESTURE_WINDOW_MS` (1 second). `RemoteTree.tsx` uses it for both owner actions and its
  overlay gate. The terminal client's equivalent is `pressedWithin` in `apps/tui/src/keys/stops.ts`,
  fed by every `pressable` press, and its `RemoteTree.tsx` uses it.
- **Compiled contributors.** At a point that declares actions, both `Slot`s wrap a compiled
  contributor in an element that records its presses and hand it the same `host.invoke`, answered by
  `answerOwnerInvoke`. At a point without actions nothing changes.
- **Owners.** `PreviewPane.tsx` draws the slot after its developer tools button and before the
  spinner. `url` is the address the native page last reported, not the address box. The slot is keyed
  on the task, and the handler checks the page is ready, then the task, the Node, and `expectedUrl`,
  then calls `preview.command(taskId, 'reload')`. `TerminalPanel.tsx` draws the slot after **Stop** and
  before **Hide terminals**, keyed on the task, and the terminal client's `Sessions.tsx` draws it under
  its actions. Both send the same interrupt as the owner's own control.
- **Discovery and docs.** The `plugin_authoring` brief names both points, props, actions, and reasons.
  [Toolbar actions](../../plugins/toolbar-actions.md) owns the contract, with a row and the
  `byPerson` paragraph in [remote points](../../plugins/remote-points.md), and pointers from
  [host webviews](../../shell/webviews.md) and [terminal sessions](../../terminal/sessions.md).

### Decisions and deviations

- **The host measures and the owner decides.** `byPerson` goes to every handler rather than a new
  per-action flag on the point, so no protocol or manifest field changed. Existing handlers ignore it.
  Focus doesn't count, and a press in one contributor doesn't count for another.
- **A refusal is an answer.** Actions resolve `{ ok: false, reason }` with `needs_person`, `changed`,
  or `unsupported`, so the contributor draws the reason and the owner's view carries on. Only an
  undeclared action is an error, `unknown_action`, as before.
- **The task check is a remount.** Keying each slot on its task means a task switch replaces the
  contributor's tree, and the old mount's handler compares its captured task with the owner's.
  Preview also captures the Node at mount. Interrupt's session check covers the terminal's Node, since
  the session list is per Node.
- **Preview has no terminal host.** Its pane needs the `preview` seam, so the terminal client offers no
  Preview and the point never draws there. `unsupported` covers a desktop pane with no live page.
- **Overlay fix outside the plan.** A loaded tree's companion overlay never opened when the frame id
  lacked the plugin prefix. The extension and frame registries read the Node's roster row, which keeps
  the manifest's spelling, while `RemoteTree` compared and opened the namespaced spelling. It returned
  `unknown_overlay`, and once compared both ways it waited forever. `RemoteTree` now compares both
  names qualified and opens the overlay under the descriptor's own spelling. A grants test covers it.
- **No committed loaded fixture,** as in phases 01 to 10. Automated tests use compiled contributors.
  The real-host plugin was a scratch build in `/tmp` with **Scratch reload**, **Stale reload**, **Note**
  (its overlay), **Scratch ^C**, **Other ^C**, and a timer that asks on its own.

### Verification

Run with Node 26.8.1.

- `Slot.test.tsx` (3 new): a compiled contributor's `byPerson` is false for a timer, a synthetic
  event, and a press in another contributor, and true for a trusted press in its own element. An
  undeclared action is refused before the owner hears of it. No host is given at a point without
  actions. `RemoteTree.grants.test.tsx` (2 new): `byPerson` for focus, a synthetic press, a trusted
  press, and after the window, and the bare overlay spelling.
- `PreviewPane.test.tsx` (5 new): five contributors draw four and a count after the owner's controls,
  no page means no `url` and `unsupported`, reload only after a press in that contributor and only for
  the page on screen, refusals after a page, Node, or task change, a navigation request refused, and a
  disabled registration. `TerminalPanel.test.tsx` (5 new): the same for interrupt, plus a supplied
  session that isn't selected, a stopped and a vanished session, and one mount across tab switches.
  Removing the `expectedSessionId` check fails a test.
- `apps/tui/src/chrome/Sessions.test.tsx` (1 new): a click in cells interrupts, and an unprompted call
  is refused. `pluginAuthoring.test.ts` checks the brief.
- Suites: `@acorn/client-core` (2,718), `@acorn/plugin-preview` (36), `@acorn/plugin-terminal` (205),
  `@acorn/node-core` (1,760), `@acorn/plugin-api` (14), and `acorn-plugin-sdk` (12) pass. `@acorn/tui`
  fails only the two known `chrome.test.tsx` marker tests. `@acorn/arch-tests` fails the 15 known dead
  links and one `docCitations` entry from phase 10 (see below). `tsc` is clean for preview, terminal,
  client-core, and node-core. The terminal and desktop show only the known git and agents errors, and
  oxlint flags nothing in the changed files.
- **Desktop, `pnpm dev:agent --fixture tui-navigation`,** with a local page as the project's preview
  URL. The trust prompt listed both contributions. Preview's bar read Back, Forward, Reload, Home, the
  address, Copy, developer tools, then the three scratch buttons, with `url=http://127.0.0.1:5199/`.
  The timer's reload answered `needs_person`, and so did a driver click and a focused click. **Note**
  opened the plugin's overlay with the URL as its input, and closing it answered `null`. The drawer
  read **+**, **Stop**, **Scratch ^C**, **Other ^C**, **Hide terminals** above a running shell, the timer
  answered `needs_person`, and focusing the PTY first changed nothing. With the plugin disabled and the
  Node restarted, Preview's bar had only its own six controls.
- **Terminal, `pnpm dev:tui:agent --fixture tui-navigation`.** The trust prompt listed both. The
  sessions view drew the buttons under its actions with "no session", then "Shell:running" in place
  once a shell started. Enter on **Scratch ^C** answered `ok` and the shell redrew its prompt. **Other
  ^C** answered `changed`. The palette offered no Preview.
- **Not checked in a real host:** an accepted desktop press. The WebDriver driver clicks with
  `el.click()`, which is untrusted and sends no `pointerdown`, so every desktop driver press is
  refused. The unit tests call the real capturing listener with the trusted bit. Native-page overlap
  with the overlay: the driver can't capture the child webview. The overlay is the same host overlay
  as any other, drawn as [host webviews](../../shell/webviews.md#host-owned-webviews) describes.

### What later phases need to know

- An owner whose action is a person's act reads `invocation.byPerson` and refuses without it. Key the
  slot on whatever identity the action must not cross, and capture it in the handler.
- `docCitations` fails on `fenceViewers.ts`, which cites `remote-points.md § Markdown fences`, a
  heading that doesn't exist. It's from phase 10.
- The frame and chrome registries read raw roster rows while `eligiblePlugins().installed` is
  namespaced. Anything that compares a declared surface id across the two needs both spellings.
- The terminal startup closure is 689,582 of 700,000 bytes, and the Node service 1,757,365 of
  1,759,000 bytes.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
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
