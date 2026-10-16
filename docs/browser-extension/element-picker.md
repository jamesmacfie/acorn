# Ask Acorn about an element in the browser extension

This page covers how a person picks an element on a task's page with the
[browser extension](../browser-extension.md), types a question in a box beside it, and sends it to
the task's agent. Read it before you change the picker, the box, or the checks behind them. The
background's half is `apps/extension/src/background/askElement.ts`. The picker and the box are
`apps/extension/src/content/picker.ts`, built as `picker.js`. Their messages are typed in
`apps/extension/src/handoffs.ts`.

## Starting a pick

The picker works only on a page that [belongs to a task](./task-pages.md#pages-that-belong-to-a-task),
a plugin's local app included. On a page that belongs to several tasks, it asks the first, as the
task chip shows the first. A pick starts in one of two ways:

- **Ask Acorn about this element** on the page's right-click menu, for a page, link, image, video, or
  audio. Like [Add to Acorn chat](./page-capture.md#add-to-acorn-chat), the entry is always on the
  menu. When the picker is already on the page, it saw the right-click and opens the box beside that
  element. Otherwise the background injects `picker.js`, and the person points at the element.
- **Ask about an element** in the menu of the [task chip](./handoffs.md#task-chips) or the
  [branch marker](./task-pages.md#the-branch-marker), in both browsers. The person points at the
  element. The chip's script starts the picker through a global the two scripts share in the
  extension's isolated world, which the page can't reach. The build wraps each script in its own
  function, so their minified names don't overwrite each other in that shared scope.

While the person points, an outline follows the element under the pointer, and a click picks it. The
page sees none of the pointer's presses then, so picking a button doesn't press it. **Esc** cancels.

The right-click entry picks nothing when no Node is selected, the page belongs to no task, or the
click was inside a frame. The panel opens and says why in one line. The background decides from what
it holds in memory, so the panel can open inside the click. A background that has only just started
holds no task list, and refuses every page until it reads one. It runs while a Node's host is
connected, so that happens only when the host is down.

## The box

The box sits below the element, or above it when there's no room, inside the viewport. It takes the
page's light or dark theme and draws in a closed shadow root, as the task chip does. From the top, it
holds:

1. A line naming the element: a crosshair, its tag with its `id` or first class, and its size, such
   as `button.pay-now · 168 × 34`.
2. The question field.
3. A bar with **To** on the left, a faint **esc** that closes the box, and **Send ↵** on the right.

**To** shows where the question goes, such as **New chat · Claude**, and opens a menu inside the
box's shadow root with two groups:

- **New chat**: one row per row of `agents.choices` that can start, the same rows as the sidebar's
  **New chat**: each harness or its named logins, then each custom agent. For more information, see
  [the agent operations](./conversations.md#the-agent-operations). A row's value is its `choiceKey`,
  the harness, login, and custom agent joined with colons, such as `claude:work:`, so a new chat
  starts the row the person chose.
- The task's title: one row per conversation in the task that isn't archived.

**To** starts on a new chat with the row last used from the box, stored as `askAgent:<nodeId>`
([browser storage](./conversations.md#browser-storage)), else the first. With no agent able to start,
it says "No agent can start on this Node", and **Send** stays off until the person picks a
conversation. With no conversation either, **To** is off. Choosing a row sets **To** and closes the
menu. The menu opens under **To**, or above it when the box sits too low, and closes on Escape or a
click anywhere else.

The icons are the kit's Lucide shapes, inlined in `picker.ts`, because a content script can't import
the kit.

**Enter** sends, and **Shift+Enter** adds a line. **esc**, the Escape key, a tab switch, a
navigation, or the element leaving the page closes the box and sends nothing. With the menu open,
Escape closes the menu first.

**Send** opens the panel inside the click. The background then uploads the screenshot, makes the new
chat if one was chosen, and submits the turn. On success the box closes, the background saves the
conversation as the panel's destination, and the panel shows it, where the reply arrives. Firefox
can't open its sidebar from a page, so there the box says "Sent. Click Acorn in the toolbar to see
the reply." for four seconds, then closes. A failed send keeps the box open with one line saying why.

## What the agent receives

The turn is built with `withCapture()` and `turnInput()` in `apps/extension/src/capture.ts`, like the
composer's [captures](./page-capture.md#what-a-capture-is), and has up to three parts:

1. The question, as the `text` part.
2. A `context` part labelled `Element on <page title>`. Its content is `Page: <address>`,
   `CSS path: <path>`, and `Size: <width> × <height> CSS pixels`, one to a line, then a blank line
   and the cleaned HTML. The Node wraps it in `<acorn-context source="browser-extension">`, so the
   page's HTML can't pass for the person's own words.
3. An `image` part: a screenshot of the visible tab, cropped to the element with 8 CSS pixels of
   padding and clamped to the picture, as a JPEG at quality 90.

The background takes the screenshot as the box opens, with `cropScreenshot()` in `capture.ts`. The
box stays hidden until the background answers, and the picker asks two animation frames after the
outline leaves the screen, so neither shows in the picture. The screenshot needs `activeTab`
([page access](./page-capture.md#page-access)), which the right-click entry grants. A pick from the
chip's or the marker's menu has it only when the person clicked the toolbar button on that tab since
it last navigated. On a granted site without it, both browsers refuse the screenshot.

Every failure sends the question without a screenshot, and the box says "This goes without a
screenshot: the browser didn't allow one here." That covers a refusal, another page at the front of
the window, a crop with nothing in it, and a picture over the 5 MiB capture limit.

### HTML cleaning

On **Send**, the picker cleans a copy of the element imported into a document of its own, which
loads no images and runs no handlers:

- It removes `script`, `style`, `noscript`, `template`, `link`, `meta`, and `input[type=hidden]`.
- It removes every `value` attribute, every `on*` attribute, and `srcdoc`.
- It replaces a `data:` or `blob:` address in `src`, `href`, `srcset`, or `poster` with `[data URL]`.
- It keeps every other attribute, such as `class`, `style`, `id`, `role`, `aria-*`, and `data-*`,
  because they're what an agent uses to find the component.
- It collapses runs of whitespace and cuts the result to 50 KiB, ending it with
  `<!-- truncated by Acorn: N KiB more -->`.

`outerHTML` never carries what the person typed into a field, only the `value` attributes the page
set, and those go too.

### CSS path

The picker sends the shortest selector it finds that matches only this element: its `id` when that's
unique, else its `data-testid` when that's unique, else `tag:nth-of-type()` steps up to the nearest
ancestor with a unique `id`, or to `body`.

## Trust checks

A page can't message the extension, and the picker acts only on trusted clicks and keys, so a page
can't pick or send for the person. The element's HTML and path still come from the page, so the
background checks every value. It answers a box only from a tab's top frame, and refuses a send
unless all of these hold:

- The box is the one it last opened on that tab. A new box on a tab replaces the last.
- The same Node is selected, and the page still belongs to the task the box opened for, by the
  address the browser reports for the tab, never one the page supplied.
- A chosen conversation is in the list the background read when the box opened.
- A chosen agent row is one of the rows that could start when it read them, for the same Node.
- The question is 1 to 20,000 characters, and the HTML is at most 50 KiB.

The host checks `turn.submit` against its own schema again. A page address reaches the Node only on
**Send**, as with a capture.

## Retries

For each pick, the background keeps the screenshot's attachment ID, the `session.create` key with its
agent row and the chat it made, and the `turn.submit` key with the conversation and input it went with. A
second **Send** reuses them, so a send the Node didn't confirm can't make a second chat or turn, and
the Node keeps one copy of the screenshot. A changed question gets a new turn key. After an uncertain
failure, the box names the step the Node didn't confirm and says **Send** retries it.

## Limits and gaps

- A page sees the keys typed into the box. They cross the shadow boundary, and the page's
  capture-phase listeners run before the box's. The box stops them bubbling, so the page's own
  shortcuts don't fire, but a page listening in the capture phase reads the question as it's typed.
  That's acceptable on the person's own task pages, the only pages the box opens on.
- The retry keys live in the background's memory. If Chrome stops the service worker between an
  unconfirmed send and the retry, the retry uses new keys and might make a second chat. Move them to
  `storage.session` if that happens in practice.
- One element at a time, never one inside a frame, and no keyboard shortcut. The reply shows in the
  panel only, never in the box.
- The picker, the box, the checks, and the retries are covered by unit tests under jsdom and the fake
  browser. In Chrome 155 on October 14, 2026, the crop ran in a real extension service worker on a
  2400 × 1904 screenshot, and a granted site's screenshot refusal was confirmed
  ([page access](./page-capture.md#page-access)). The whole flow wasn't run against a Node in a
  browser, and Firefox wasn't run at all. No driver can click a browser's own right-click menu.

## Why

The background, not the page, names each pick, because `crypto.randomUUID()` exists only in secure
contexts, and a local app on a network address over plain HTTP isn't one. Cleaning runs in the
picker because Chrome's service worker has no DOM to parse HTML with.

The reply shows in the panel, which already draws conversations, requests, and approvals. A view
inside the page would need an extension frame the manifest doesn't declare, or agent output drawn
into someone else's page. The background repeats a few steps of the composer's send instead of
sharing them, because the composer's send is bound to draft storage.
