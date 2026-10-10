# Toolbar actions

This page covers `preview:toolbar-actions` and `terminal:toolbar-actions`, the two points that let a
plugin put its own controls beside Preview's address bar and the terminal's controls. Read it before
you fill either point, or before you add a person-only action to a point of your own. It's part of the
[plugin reference](../plugins.md), beside [remote points](./remote-points.md).

## What each point offers

Both are `remote` and `stack`, up to four, with no key. The owner's own controls stay outside the slot
and always draw. A fifth contributor is a count, "1 more from other plugins".

| Point | Drawn | Props | Action |
| --- | --- | --- | --- |
| `preview:toolbar-actions` | After Preview's address bar and developer tools button, before the loading spinner. Desktop only | `{ taskId, projectId?, url?, loading, canGoBack, canGoForward }` | `reload`, `{ expectedUrl }` |
| `terminal:toolbar-actions` | Desktop: in the drawer's tab strip, after **Stop** and before **Hide terminals**. Terminal client: on a line under the sessions view's actions | `{ taskId, projectId?, session?: { id, title, running } }` | `interrupt`, `{ expectedSessionId }` |

`url` is the address the native page last reported, not the text in the address box. It's absent
until a page loads, so don't offer a reload without it. `session` is the selected session, absent when
the task has none. A contributor gets nothing else: no page contents, no way to navigate, no PTY
input or output, no environment, and no command history. A need for any of those is a separate
capability, not a toolbar prop.

The terminal client has no native page, so Preview isn't offered there and its point never draws.

```ts
const answer = await mount.host.invoke('interrupt', { expectedSessionId: props.session.id })
if (!answer.ok) showWhy(answer.reason)
```

## What the owner checks

Each action answers `{ ok: true }` or `{ ok: false, reason }`. A refusal is an answer, not a thrown
error, so draw the reason in your own control. The owner's view carries on either way.

- `needs_person`: the call didn't follow a person's press or key inside your tree within the last
  second. A timer, a props update, or focus that happens to sit in your tree doesn't count. A press in
  another contributor's control doesn't count for yours.
- `changed`: the page on screen isn't `expectedUrl`, the selected session isn't `expectedSessionId`
  or has stopped, or the task or Node changed since your tree mounted.
- `unsupported`: Preview has no live page to reload.

The slot is keyed on the task, so a task switch unmounts your tree and mounts a fresh one. A call from
the old mount is refused. Reload presses Preview's own reload for the page on screen. Interrupt sends
the same Ctrl+C as the drawer's **Stop**. Anything but the declared action is refused with
`unknown_action` before the owner hears of it.

A loaded contributor can open its own [companion overlay](./remote-points.md#companion-overlays)
from a press. It sits over the native page the way any host overlay does (see [host
webviews](../shell/webviews.md#host-owned-webviews)), and gets only the input your tree passes.

## The person check

The host measures, and the owner decides. Every owner action handler gets a second argument,
`{ byPerson }`:

- On the desktop, `byPerson` is true after a trusted `pointerdown` or `keydown` inside that mount's
  element in the last second. Synthetic events don't count.
- In the terminal client, it's true after a person presses a control inside that mount, by key or by
  mouse. A worker can't press a host control.

A compiled contributor at a point that declares actions gets the same `host.invoke` prop, wrapped in
an element that records its presses, so first-party code meets the same rule.

| Piece | Owner |
| --- | --- |
| The person record and `answerOwnerInvoke` | `client-core/src/host/tree/hostRequests.ts` |
| The compiled contributor's `host` | `client-core/src/host/tree/Slot.tsx`, `apps/tui/src/kit/host.tsx` |
| The terminal client's press record | `apps/tui/src/keys/stops.ts`, `pressedWithin` |
| Preview's contract and reload | `plugins/preview/src/contract/toolbarActions.ts`, `client/PreviewPane.tsx` |
| Terminal's contract and the shared interrupt check | `plugins/terminal/src/contract/toolbarActions.ts` |
| The two interrupt handlers | `plugins/terminal/src/client/TerminalPanel.tsx`, `apps/tui/src/chrome/Sessions.tsx` |
