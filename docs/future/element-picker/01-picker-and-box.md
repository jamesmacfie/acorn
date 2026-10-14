# Ticket 1: the picker and an empty box

## Completion note

October 14, 2026. Done, with every item in "Build" except the `acorn:ask.*` types.

What landed:

- `src/content/picker.ts`, built as `picker.js`. The build's "no imports" check covers both content
  scripts through one `CONTENT_SCRIPTS` list in `vite.config.ts`. `drawTab()` injects
  `['content.js', 'picker.js']` in one call.
- The picker records trusted right-clicks, outlines the element under the pointer, picks on a trusted
  click, and cancels on **Esc**. While the person points, it swallows pointer presses and clicks in the
  capture phase, so picking a button doesn't press it. The box closes on **Cancel**, **Esc**, a tab
  switch, `pagehide`, `popstate`, and when the element leaves the page. The box stops key events
  from bubbling, so page shortcuts don't fire while the person types.
- `src/background/askElement.ts` adds **Ask Acorn about this element** for the `page`, `link`,
  `image`, `video`, and `audio` contexts. It refuses with a `notice` and opens the panel when no Node
  is selected, the page matches no task, or the click came from a frame.
- **Ask about an element** sits in the chip menu (task chips only, both browsers) and the marker menu.

Decisions and deviations:

- The picker script publishes its start function as `globalThis.acornPicker`. That global doubles as
  the "already injected" guard. `content.js` calls it from the menu item, because both scripts share
  the extension's isolated world and a page can't reach it there. No message or DOM event is
  involved.
- The picker answers `acorn:pick` with `sendResponse(true)` and returns `true`. The background sends
  `{ mode: 'target' }` first. When the answer isn't `true`, the picker isn't on the page, so the
  background injects `picker.js` and sends `{ mode: 'hover' }`. That covers a rejected send, and a
  page where only `content.js` received the message and answered nothing. It injects only `picker.js` on demand, not `content.js` too, because
  `content.js` draws nothing without an `acorn:buttons` message.
- The refusals are decided inside the click from what the background holds in memory
  (`buttons.nodeId` and `pages.tasks`), so the panel can open in the person's gesture. A background
  that has just started has no task list. It stays running while a Node's host is connected, so this
  matters only when the host is down.
- `acorn:ask.open`, `acorn:ask.send`, and `acorn:ask.cancel` aren't in `handoffs.ts`. knip fails
  `pnpm lint` on an exported type nothing imports. Add them in ticket 2 with their first use.
- `acorn:chip` and `acorn:marker` get no `'pick'` action. The page starts the picker itself, so
  nothing sends it, and the marker handler treats any action but `hide` as `show`.
- **Enter** to send isn't wired, because **Send** stays disabled until ticket 2.

For later tickets:

- The box's question field is the `textarea`, and its dropdowns are the two `select` elements with
  `aria-label` **Conversation** and **Agent**. **Send** is `.send`. `ask()` in `picker.ts` builds them.
- `stop()` in `picker.ts` is the one place the box closes. Ticket 2 should send `acorn:ask.cancel`
  from there.
- The fake browser's `tabs.sendMessage` rejects for a tab with no injected script, as a browser does,
  and returns `fake.pageAnswer(message)` otherwise. `fake.injectedFiles` records each injection's
  files. `runtime.onMessage` listeners take a `sendResponse` third argument. `clickMenu(id, frameId)` takes a frame.
- In jsdom, `window` has its own `addEventListener`, separate from `EventTarget.prototype`. Spy on
  both, as `picker.test.ts` does, to reach the picker's window listeners.
- Already red at this base, untouched here: oxlint's unused `openChat` import in
  `sidebar/Handoff.test.tsx`, and the formatter check on `manifest.ts`, `sidebar/Conversation.tsx`,
  and `sidebar/Workspace.tsx`.

Status: proposed, October 14, 2026. Depends on nothing. Read [the context doc](./README.md) first: it
holds every decision, its precedent, and the trust rules this ticket must follow.

## Goal

On a task page, the person can pick an element and see the box beside it. **Send** is disabled. Off a
task page, the right-click entry refuses in one line.

## Build

1. Add `src/content/picker.ts`, built as `picker.js` by a `picker` entry in `vite.config.ts`, with the
   same "no imports" check `content.js` has.
2. In `src/background/siteButtons.ts`, inject `picker.js` wherever `drawTab()` injects `content.js`.
3. In `picker.js`: the `contextmenu` target recorder, the hover outline, a trusted click to pick, and
   **Esc** to cancel. See [The picker script](./README.md#the-picker-script).
4. Draw the box in a closed shadow root beside the element: a question field, two empty dropdowns, a
   disabled **Send**, and **Cancel**.
5. Add `src/background/askElement.ts`, wired from `background.ts` like `selectionMenu()`. It adds the
   right-click entry **Ask Acorn about this element** at install, for the `page`, `link`, `image`,
   `video`, and `audio` contexts.
6. On a click of the entry: refuse with a `notice` when no Node is selected, the page belongs to no
   task, or the click came from a frame. Otherwise inject both scripts if needed and send
   `{ type: 'acorn:pick', mode }`, with `target` when the picker script was already on the page.
7. Add **Ask about an element** to the chip's and the marker's menus in `src/content/siteButtons.ts`.
   It starts the hover picker in the page.
8. Add the message types to `src/handoffs.ts`. See [Messages](./README.md#messages).

## Done when

- Right-clicking a button on a task's pull request page and choosing the entry shows the box beside
  that button.
- The chip menu item starts the hover picker, and **Esc** cancels it.
- On a page with no task, the panel opens with one line saying why nothing happened.
- Tests cover the refusals in `background.test.ts` and the picker's pick and cancel under jsdom.
