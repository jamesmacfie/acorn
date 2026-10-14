# Ticket 1: the picker and an empty box

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
