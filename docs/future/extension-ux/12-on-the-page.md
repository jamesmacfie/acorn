# Phase 12: the chip, the marker, and the ask box on the page

Date: October 16, 2026. Status: done on October 17, 2026. Depends on [phase 1](./01-navigation.md),
so **Show in side panel** opens a task, and [phase 5](./05-this-page.md), for the start chip's card.

## Completion note

Landed on October 17, 2026. The task chip's menu reads **Show in side panel**, **New chat about this
page**, **Ask about an element**, a separator, **Open in Acorn**, and **Copy Acorn link**, each with
its Lucide icon. The branch marker's menu is the same without **New chat about this page**, then a
separator and **Hide on this site**. The start chip offers **Create task** and **Run workflow…**, and
**Run workflow…** opens Home's issue card with its workflow picker open. The ask box has a line
naming the element, the question, and a bar with **To**, a faint **esc**, and **Send ↵**. **To**
opens a menu of new chats, one per agent that can start, and the task's conversations under its
title. [Handoffs](../../browser-extension/handoffs.md),
[the branch marker](../../browser-extension/task-pages.md#the-branch-marker),
[ask Acorn about an element](../../browser-extension/element-picker.md),
[workflows](../../browser-extension/workflows.md), and three site pages are updated.

Decisions and deviations:

- **Show in side panel** and **New chat about this page** already went to the task and its pending
  item, from phases 1 and 5, so change 2 needed no code.
- The kit's `Picker` gained `defaultOpen`, which opens it once it mounts. The handoff card passes it
  while the chip's `workflow` start is unused, so the picker opens with the card, and stays closed
  after the person picks a workflow and cancels it. The terminal host's `Picker` doesn't read it,
  because nothing there needs it. `start: 'workflow'` no longer chooses the first workflow.
- A menu's separator goes in before the next entry, so a menu that leaves entries out, as in Firefox
  or with no Acorn link, never starts, ends, or doubles one.
- The ask box's element line shows the tag with its `id` or first class, as the prototype does
  (`button.pay-now · 168 × 34`), not the CSS path, which can run to a dozen `nth-of-type` steps. The
  path still goes to the agent.
- **Cancel** is gone, as designed, but **esc** is a button named **Cancel**, so a mouse can still
  close the box. Escape closes an open **To** menu first, then the box.
- The task's title reaches the box as `task` on `AskOpened`. With no agent able to start, **To** says
  "No agent can start on this Node" and still opens on the task's conversations. With neither, it's
  off. The rows are `menuitemradio`, with the chosen one checked and focused when the menu opens.
- The box is 340 pixels wide, not 320, so "New chat · Claude Code" fits in **To**.
- The ▾ on the chip stays text. The doc's budget is eight icons, and the chip keeps its look.
- Build fix: the background injects `content.js` and `picker.js` into one isolated world, where
  classic scripts share a global scope. Both were built as top-level `var`s, so the picker's minified
  names overwrote the chip's, and the chip threw on its next redraw. A `renderChunk` hook in
  `apps/extension/vite.config.ts` wraps each in its own function. Unit tests load each script alone,
  so they never saw it. A plain page with both built scripts and a stubbed browser API, screenshotted
  in Chrome, showed it, and shows the menus and the box in both themes.
- Sizes: `content.js` went from 7,529 to 9,290 bytes, almost all icon markup. `picker.js` went from
  7,782 to 11,185 bytes, for the **To** menu and its five icons.

Content-script only, so a plugin can't reach it: the chip, the marker, the ask box, their menus, and
their CSS live in closed shadow roots in `siteButtons.ts` and `picker.ts`. The kit can't load there:
the scripts import nothing, carry their own styles, and every byte loads into someone else's page.
They borrow the kit's Lucide shapes, inlined, and the state colours, not its components.

For later phases:

- Phase 13 is skipped. If it comes back, the ask box's **To** menu is the shape a context picker on
  the page would take.
- Tests: `siteButtons.test.ts` reads a separator as `'-'` in `items()`. `picker.test.ts` has `to`,
  `menu`, `menuLines`, `row`, and `sendTo`. `Handoff.test.tsx` has `pickedRow` for the open picker.

## Goal

What Acorn draws on a website uses the panel's verbs in the panel's order. The task chip keeps its
look. **Show in side panel** opens the task, not Home. The chip on a page no task holds offers **Create
task** and **Run workflow…**, each opening the panel's issue card with that action ready. The ask box
has one **To** picker in place of two dropdowns.

## In the prototype

- Scenarios: **Task chip**, **Start task chip**, **Branch marker**, and **Ask about an element**. In
  the last, click **Send**, or open the marker's menu, choose **Ask about an element**, and click
  something on the page.
- Notes: `chip` at line 1332, `start-chip` at line 1333, `marker` at line 1334, and `ask` at line 1335.
- Code: `chipOnPage` at line 1184 draws the chip and its count. `pageMenu` at line 1195 lists both
  chip menus and the marker's. The marker is drawn in `pageView`, after `pageMenu`. `askBox` at line
  1233 draws the ask box, with its **To** menu. The `ask-send` action, near line 1550, shows what
  **Send** does.

## Starting point

- `apps/extension/src/content/siteButtons.ts` draws the chip and the marker in closed shadow roots,
  with their menus. The chip's menu today: **Show in side panel**, **Open in Acorn ↗**, **New chat
  about this page**, **Ask about an element**, and **Copy Acorn link**. With no task: **Create task**
  and **Start workflow…**. The marker's: **Show in side panel**, **Open in Acorn ↗**, **Ask about an
  element**, **Copy Acorn link**, and **Hide on this site**.
- `chipTask` in `apps/extension/src/background/taskPages.ts` already shows "1 waiting" in amber over
  "1 working".
- **Show in side panel** reports `acorn:chip` with `show`, and the sidebar's `showTask` goes Home.
- `apps/extension/src/content/picker.ts` draws the ask box: a question field, a **Conversation**
  select with **New chat** and the task's conversations, an **Agent** select shown only for a new
  chat, **Cancel**, and **Send**. **Send** already opens the panel on the conversation.

[Handoffs](../../browser-extension/handoffs.md),
[the branch marker](../../browser-extension/task-pages.md#the-branch-marker), and
[ask Acorn about an element](../../browser-extension/element-picker.md) document today's behavior.

## The design

### The task chip's menu

In this order, each with its icon:

1. **Show in side panel**, `panel-right`
2. **New chat about this page**, `message-square-plus`
3. **Ask about an element**, `crosshair`
4. A separator.
5. **Open in Acorn**, `arrow-up-right`. Drop the "↗" from the text.
6. **Copy Acorn link**, `copy`

Keep the rules for Firefox, where a page can't open the panel: leave out the panel entries and keep
the note.

**Show in side panel** opens the page's task with phase 1's `openTask`. **New chat about this page**
opens the task's Agents with the page's link as the pending item for that task, from phase 5.

### The start chip's menu

On a page with an item and no task: **Create task**, `plus`, and **Run workflow…**, `workflow`. Rename
**Start workflow…**. Each opens the panel on Home with the issue card. **Run workflow…** opens the
card's workflow picker.

### The branch marker's menu

The task chip's menu without **New chat about this page**, then a separator and **Hide on this site**,
`eye-off`. Leave its look and its corner alone.

### Icons in a content script

The content script can't use the kit, and every byte it carries loads into the page. Inline the SVG
for the eight icons above, taken from the kit's Lucide set so they match, in one small map in
`siteButtons.ts`. Don't import the icon registry.

### The ask box

From the top:

1. A line naming the element: a `crosshair`, its CSS path, and its size, such as "button.pay-now ·
   168 × 34".
2. The question field, "Ask about this element".
3. A bar: the **To** control on the left, a faint `esc` hint, and **Send ↵** on the right.

**To** shows the destination: "New chat · Claude Code" by default, the first agent that can start.
It opens a menu with two groups:

- **New chat**: one row per agent that can start, each with a plus.
- The task's title: one row per conversation in the task, each with a speech bubble.

Choosing a row sets **To** and closes the menu. With no agent able to start and no conversation,
**To** says "No agent can start on this Node" and **Send** stays off, as today.

Enter sends. Shift with Enter adds a line. Escape closes the box. **Send** keeps today's behavior: it
opens the panel on the conversation, with the element and its screenshot attached.

Draw the menu inside the box's shadow root, positioned under **To**, and close it on an outside
click. Keep the box's light and dark themes from the page.

## Changes

1. Reorder the chip's and the marker's menus, add icons, and rename **Start workflow…**.
2. Route **Show in side panel** to `openTask`, and **New chat about this page** to the task's pending
   item.
3. Route the start chip's two entries to Home's issue card with the action ready.
4. Replace the two selects in `picker.ts` with **To** and its menu, and add the element line and the
   keys.
5. Update `apps/extension/src/content/siteButtons.test.ts`, `apps/extension/src/content/picker.test.ts`,
   and `apps/extension/src/background/background.test.ts` for the new orders, names, and keys.
6. Update [handoffs](../../browser-extension/handoffs.md), [the branch
   marker](../../browser-extension/task-pages.md#the-branch-marker), and [ask Acorn about an
   element](../../browser-extension/element-picker.md).

## Acceptance

- On a pull request a task holds, the chip's menu lists the six entries in order, with icons.
- **Show in side panel** opens that task in the panel.
- On a pull request no task holds, **Run workflow…** opens Home with the issue card's workflow picker.
- In the ask box, **To** › one of the task's conversations, then Enter, sends the question to that
  conversation and opens it in the panel.
- The content script's bundle grows by no more than the eight icons.
