# Ask Acorn about an element

Date: October 14, 2026. Status: proposed. Baseline: `209735ede`.

This product requirements document covers an element picker in the browser extension. On a page that
belongs to an Acorn task, a person picks part of the page, asks a question in a small box beside it,
and sends the question to the task's agent with the page address, the element's HTML, a CSS path to
it, and a cropped screenshot. It is for implementers of `apps/extension`. The tickets in this folder
each point back here, and this page holds every decision and its reason.

## Problem and outcome

A person looking at a task's local app, such as a Runn stack, sees a button in the wrong place. To get
the agent working on that task to fix it, they switch to Acorn, describe the button in words, maybe
take a screenshot, and hope the agent finds the right component. The extension can already capture a
page's link, selected text, or a screenshot into a draft (`apps/extension/src/capture.ts`), but none
of those say which element the person means.

The required outcomes are:

- On a task page, the person picks an element by right-clicking it or by hovering and clicking.
- A box beside the element takes a question, a conversation, and an agent, and sends with one press.
- The agent receives the question, the page address, the cleaned HTML, a CSS path, and a cropped
  screenshot.
- The side panel opens on that conversation, where the reply arrives.
- Pages that belong to no task offer nothing beyond a one-line refusal.

## Scope

Chrome and Firefox, in one release. Firefox can't open its sidebar from a click on the page, so there
the box says to click Acorn in the toolbar after sending.

This work excludes replies or follow-ups inside the box, project-site pages with no task, a session
`origin` kind for the desktop, a keyboard shortcut, picking several elements, and elements inside
frames. For the reasons, see [Out of scope](#out-of-scope).

## Read this folder

| File | What it covers |
| --- | --- |
| [01-picker-and-box.md](./01-picker-and-box.md) | The picker script, the right-click entry, the chip and marker menu item, and an empty box. |
| [02-send.md](./02-send.md) | The box's options, HTML cleaning, the CSS path, sending, and opening the panel. |
| [03-screenshot.md](./03-screenshot.md) | Capturing and cropping the element's screenshot, and sending it as an image. |
| [04-reference-docs.md](./04-reference-docs.md) | Moving shipped behaviour into `docs/browser-extension/`. |

Do them in order. Each one is demoable on its own.

## Starting point

Most of what this needs is already in the extension. Recheck these against the checkout before you
start.

- **Task pages.** The background keeps the selected Node's tasks and their page addresses
  (`src/background/taskPages.ts`). `pageTasks()` in `src/taskPages.ts` matches a page to its tasks in
  the browser, so no page address goes to the Node for it. Task pages include pull requests, linked
  issues, and a plugin's local app origin. For details, see
  [Pages matched to tasks](../../browser-extension/task-pages.md).
- **Drawing in a page.** `src/content/siteButtons.ts` draws the task chip and the branch marker in
  closed shadow roots, puts every plugin or Node value in with `textContent`, and ignores clicks that
  aren't `isTrusted`. `src/background/siteButtons.ts` injects it only into tabs the extension may read
  and that match something, and checks every click against `sender.url`, the browser's record of the
  address.
- **Right-click entry.** `src/background/selectionMenu.ts` adds **Add to Acorn chat**, opens the panel
  inside the click, and reports refusals in one line through `offer({ type: 'notice' })` in
  `src/background/background.ts`.
- **Opening the panel.** `openPanel()` in `background.ts` calls Chrome's `sidePanel.open` or Firefox's
  `sidebarAction.open` inside the click. `offer()` queues a message for a panel that isn't open yet,
  so `{ type: 'open', target }` reaches it when the person opens it.
- **Sending.** The bridge has `session.create`, `attachment.upload`, and `turn.submit`
  (`packages/protocol/src/transport/extensionBridge.ts`). The sidebar sends them from
  `sidebar/agentChoice.tsx` and `sidebar/Composer.tsx`, each with an operation key so a retry can't
  make a second session or turn.
- **Turn input.** `withCapture()` and `turnInput()` in `capture.ts` turn captures into a turn and
  enforce the limits: eight context parts, 512 KiB of context, and eight images. The Node wraps a
  `context` part in `<acorn-context source="browser-extension">` and escapes it, so page text can't
  pass for the person's own words.
- **Agents.** `agents.profiles` lists the agents a Node can start. `agentChoice.tsx` defaults to the
  first usable one.

## How it works

1. The person right-clicks an element and chooses **Ask Acorn about this element**, or chooses **Ask
   about an element** from the task chip's or branch marker's menu and clicks an element.
2. The picker script records the element, hides its outline, and tells the background, which takes
   the screenshot and checks the page still belongs to the task.
3. The box opens beside the element with a question field, a conversation dropdown, an agent
   dropdown, **Send**, and **Cancel**.
4. On **Send**, the picker script cleans a copy of the element's HTML, builds the CSS path, and sends
   both with the question and the choices to the background.
5. The background opens the panel inside the click, checks the request, then creates the session if
   needed, uploads the screenshot, and submits the turn.
6. The box closes on success. The background saves the destination and offers
   `{ type: 'open', target }`, so the panel shows the conversation.

## Decisions

| Decision | Choice | Precedent or reason |
| --- | --- | --- |
| Which pages | Task pages only, local app origins included | `pageTasks()` in `src/taskPages.ts`. A project site maps a page to a project, and a session needs a task. |
| Which task on a page with several | The first match | The chip does the same (`chip:` in `background.ts`). |
| Conversation | A dropdown: **New chat**, selected by default, or one of the task's conversations | One session per question, like the inline diff chat in `plugins/agents/src/contract/inlineDiff.ts`. The list comes from `taskPages().sessions(taskId)`, with `sessions.list` when it isn't read yet. |
| Agent for a new chat | A dropdown, defaulting to the agent last used from the box, else the first usable one | `agentChoice.tsx` for the default. Remembered in `storage.local` as `askAgent:<nodeId>`, shaped like `siteChoices:<nodeId>` in `src/pageScope.ts`. Hidden when an existing conversation is chosen. |
| Send | One press sends: `session.create` when needed, `attachment.upload`, then `turn.submit` | The same calls and keys as the composer. No bridge, host, or agents plugin change. |
| Reply | In the side panel | Reuses the panel's whole conversation view. A second view inside the page would be a second chat client to keep in step. |
| Starting it | The right-click entry, always on the menu, plus a menu item on the chip and the marker | `selectionMenu.ts` keeps its entry always on the menu, so it doesn't come and go with state the page doesn't show. The right-click also grants `activeTab`, which a Firefox screenshot needs. |
| Payload | The question as a `text` part, one `context` part, and one `image` part | Reuse the `context` and `screenshot` kinds of `PageCapture`, `withCapture()`, and `turnInput()`. No capture kind is added. |
| Context part | Label `Element on <page title>`. Content: the address, the CSS path, the element's size in CSS pixels, then the cleaned HTML | `contextPart()` in `capture.ts`. `resourceId` is the address, as for a link. |
| Where cleaning runs | In the picker script, on a clone of the element | Chrome's service worker has no DOM, so the background can't parse HTML. |
| Where the picker lives | `src/content/picker.ts`, built as `picker.js`, a second classic script | Keeps `content/siteButtons.ts` to chips. The build already refuses imports in `content.js` (`vite.config.ts`). The same check covers `picker.js`. |
| Trust checks | Described in [Trust and privacy](#trust-and-privacy) | The chip's click handling in `background/siteButtons.ts`. |

## The picker script

`picker.js` is injected with `content.js` wherever `drawTab()` injects it, and on demand after a
right-click on a page that has neither. It guards against a second copy as `content.js` does, with a
global flag.

- It records the target of every `contextmenu` event in the top frame, so a right-click entry can
  pick that element without the hover step.
- The hover picker outlines the element under the pointer with an overlay in its own closed shadow
  root. A trusted click picks it. **Esc** cancels. Scrolling and resizing move the outline.
- The overlay and the box are never pickable.
- The box sits below the element, or above it when there's no room, inside the viewport. It takes the
  page's light or dark theme the way `darkPage()` does in `content/siteButtons.ts`.
- **Enter** sends, **Shift+Enter** adds a line, and **Esc** cancels.
- A navigation, a tab switch, or the element leaving the page closes the box and sends nothing.

### HTML cleaning

On a clone of the picked element:

- Remove `script`, `style`, `noscript`, `template`, `link`, `meta`, and `input[type=hidden]`.
- Remove every `value` attribute, every `on*` attribute, and `srcdoc`.
- Replace `data:` and `blob:` URLs in `src`, `href`, `srcset`, and `poster` with `[data URL]`.
- Keep `class`, `style`, `id`, `aria-*`, `data-*`, and `role`, because they're what an agent needs to
  find the component.
- Collapse runs of whitespace.
- Cut the result at 50 KiB and end it with `<!-- truncated by Acorn: N KiB more -->`.

`outerHTML` doesn't carry what a person typed into a field, only the attribute the page set. Removing
`value` attributes covers prefilled fields too.

### CSS path

The shortest path that matches only this element: its `id` when it's unique, else a
`data-testid` when it's unique, else `tag:nth-of-type()` steps up to the nearest ancestor with a
unique `id`, or to `body`.

## Messages

Add these to `src/handoffs.ts`, beside `ContentMessage` and `ButtonClick`:

| Direction | Message | Purpose |
| --- | --- | --- |
| Background to page | `{ type: 'acorn:pick', mode: 'hover' \| 'target' }` | Start the hover picker, or use the element from the last right-click. |
| Page to background | `{ type: 'acorn:ask.open', pickId, rect, devicePixelRatio }` | An element was picked. The background answers with the task, the conversations, the agents, the remembered agent, and whether a screenshot was taken. |
| Page to background | `{ type: 'acorn:ask.send', pickId, question, html, selector, size, sessionId \| null, providerId \| null }` | Send. The background answers with the result, or a one-line reason. |
| Page to background | `{ type: 'acorn:ask.cancel', pickId }` | Drop the screenshot and keys held for the pick. |
| Chip or marker menu | `{ type: 'acorn:chip', action: 'pick' }` and `{ type: 'acorn:marker', action: 'pick' }` | Extend the existing `action` unions. The content script starts the picker itself. The background needs no message for that. |

`runtime.onMessage` replies differ by browser. Chrome needs `sendResponse` and `return true`. Firefox
accepts a returned promise. Use `sendResponse` with `return true`, which both support.

## Trust and privacy

The background acts on a picker message only when all of these hold:

- `sender.frameId` is `0` and `sender.tab` is set.
- `pageTasks()` still matches `sender.url` to the task the box was opened for.
- A chosen conversation belongs to that task, by the list the background read.
- A chosen agent is in `agents.profiles` for the selected Node, and is usable.
- The question is 1 to 20,000 characters and the HTML is at most 50 KiB. The `turn.submit` schema
  checks its own limits again.

The picker script acts only on `isTrusted` clicks and keys, as `trusted()` does in
`content/siteButtons.ts`. A page can't call `runtime.sendMessage`, so it can't send for the person.

Known limits:

- A page sees key events typed into the box, because they cross the shadow boundary and page
  listeners in the capture phase run first. Stopping propagation inside the box doesn't stop those.
  It's acceptable on the person's own task pages. Say so in the reference docs.
- Picked HTML is untrusted. It reaches the agent only inside the `<acorn-context>` wrapper.
- A page address goes to the Node only when the person presses **Send**, as with a capture.

## Retries

The background keeps, per pick, the keys for `session.create` and `turn.submit`, the session it
created, and the attachment it uploaded. A second **Send** for the same pick reuses them, so an
unconfirmed send can't make a second chat or turn. After an uncertain failure, the box says the same
thing the composer does: the Node didn't confirm, and **Send** retries once.

This is a shortcut: the keys live in background memory, so if Chrome stops the service worker
between an unconfirmed send and the retry, the retry uses new keys and might make a second chat. Move
them to `storage.session` if that happens in practice.

## Firefox

- The right-click entry and the chip and marker menu item work the same.
- After sending, the box shows "Sent. Click Acorn in the toolbar to see the reply." for a few seconds,
  then closes. `offer()` holds the `open` message until the sidebar connects.
- A screenshot needs `activeTab`, which the right-click grants. From the chip menu on a granted site,
  Firefox refuses it, and the box says the question goes without a screenshot.

## Out of scope

- **Replies inside the box.** The panel already draws conversations, requests, and approvals. A view
  inside the page would need an extension iframe, which the manifest doesn't declare, or agent output
  rendered into someone else's page.
- **Project-site pages with no task.** There's no task for a session. Revisit if people ask for a
  "choose a task" step.
- **A session `origin` kind.** The desktop would show which element a chat started from, like the
  inline diff card. That's a change to the agents plugin's contract. The context part's label carries
  the page name in the meantime.
- **A keyboard shortcut, several elements, and frames.** Each adds UI or permission questions without
  a request behind it.
- **Firefox's `menus.getTargetElement`.** The `contextmenu` recorder works in both browsers, so one
  path is enough.
- **Shared send code with `Composer.tsx`.** The composer's send is bound to draft storage. About 30
  lines repeat in the background instead of reshaping the composer.

## Verification

- Vitest in `apps/extension`. Background flows use `src/test/fakeBrowser.ts` and `sendFromPage`, as in
  `background/background.test.ts`. Cleaning and the CSS path run under jsdom. jsdom can't make trusted
  clicks, so test the click handlers by spying on `addEventListener`, and spy on `attachShadow` to
  reach the closed roots.
- Use Node v26.8.1. The default v24.11.0 is below the engines floor.
- Manual, Chrome: run `pnpm dev:extension`, open a task's pull request or its local app, right-click
  a button, and choose **Ask Acorn about this element**. Type a question and press **Send**. The panel
  opens on a new chat holding the question, a context block with the HTML, and a cropped image.
- Manual, Firefox: the same steps. The box says to click the toolbar button, and the panel then opens
  on that chat.
- Refusals: a page with no task, a frame, a page that navigates between pick and send, and an agent
  that isn't signed in. Each refuses in one line and sends nothing.
