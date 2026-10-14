# Page capture in the browser extension

This page covers how the [browser extension](../browser-extension.md) captures a page's link, its
selected text, or a screenshot into a conversation's draft, and sends them with a message, and the
page's right-click entry. It also covers the attachment operations on the native bridge and how a
sent screenshot shows in the conversation. The code is in `apps/extension/src/`: `capture.ts` reads
the page, `localState.ts` stores drafts, `sidebar/Composer.tsx` owns the draft and the send,
`sidebar/attachmentPreviews.ts` draws sent screenshots, and `background/selectionMenu.ts` runs the
right-click entry. The host side is in `apps/cli/src/browser/bridge.ts`.

## What a capture is

The composer's toolbar has three **Add to chat** icon buttons, named by these labels:

| Button | What it keeps | What the agent receives |
| --- | --- | --- |
| **Add page link to chat** | The tab's address and title | A `context` part labelled `Page: <title>`, holding the title and address |
| **Add selected text to chat** | The page's selected text, with its address and title | A `context` part labelled `Selected text from <title>`, holding the address and the text |
| **Add screenshot to chat** | A JPEG of the visible tab at quality 90, with its address and title | An `image` part naming the attachment the Node holds for it |

The parts are the agents plugin's own turn input ([attachments](../managed-agents/attachments.md)).
The Node hands a `context` part to the agent inside an `<acorn-context source="browser-extension">` block, with
its content escaped so page text can't close the block and read as the person's own words. Captures
read the top frame of the active tab in the sidebar's window, and nothing else: no full page, no
form contents, no other tabs.

Each capture shows as a chip in the draft, with a thumbnail for a screenshot. Opening a chip shows its
address and its selected text or item context, and **×** removes it. A line under the composer names
the conversation and task the message goes to. Capturing and reviewing send nothing to the Node.

## Add to Acorn chat

Right-clicking selected text on a page offers **Add to Acorn chat**. It takes the same selection
capture as the composer's **Add selected text to chat** button, with the same limits and the same
chip, and puts it in a draft without the person opening the panel first:

1. The click opens the panel, inside the click, where both browsers allow it: Chrome's
   `sidePanel.open` and Firefox's `sidebarAction.open`.
2. The background reads the selected Node and the current task from `selectedNodeId` and
   `destination:<nodeId>` ([browser storage](./conversations.md#browser-storage)). The draft is the
   conversation the panel would open for that task: the one it last showed, or else the task's
   newest, as **Chat** opens.
3. It reads the selection from the clicked tab's window, adds it to that conversation's stored
   draft, and remembers the conversation as the one open over Home.
4. The panel opens the conversation. A composer already showing it picks the capture up from storage,
   so the next save there keeps it.

Nothing goes to the agent until the person presses **Send**. When the browser refuses to open the
panel, the draft is filled anyway, and the conversation shows with the capture when the person opens
the panel. The entry adds nothing, and the panel says why in one line, when no Node is selected, no
task is current, the task has no conversation yet, the Node can't be reached, the selection is empty,
or a limit would be passed.

The entry is always on the menu for selected text, whatever the panel's state. An entry that came and
went with the current task would change with state the page doesn't show, and the panel's line says
what to do when there's nowhere for the text to go. The menu is made once at install, and both
browsers keep it across background restarts.

## Ask Acorn about an element

Right-clicking a page also offers **Ask Acorn about this element**. On a page that belongs to a task,
it sends a question about one element straight to the task's agent, with the element's HTML, a CSS
path, and a cropped screenshot, and fills no draft. For how it works, see
[Ask Acorn about an element](./element-picker.md).

## Page access

The extension asks for `activeTab`, `scripting`, and `contextMenus`, and lists `http://*/*` and
`https://*/*` as optional host access, so it holds no site at install. A capture works when the browser
lets the extension read the active tab:

- **The toolbar button.** Clicking the Acorn button opens the sidebar and grants `activeTab` for that
  tab, until it navigates. The background handles the click itself, because Chrome's own
  open-on-click opens the panel without granting `activeTab`.
- **The right-click entries.** Clicking **Add to Acorn chat** or **Ask Acorn about this element**
  grants `activeTab` for the tab it was clicked in, as the toolbar button does, so it reads a
  selection or takes a screenshot on a site the person never granted.
- **A granted site.** A site the person granted reads without the toolbar button. In both browsers
  this covers the link and the selection, but not a screenshot: `captureVisibleTab` needs `activeTab`
  or `<all_urls>`. Chrome 155 refused it with "Either the '<all_urls>' or 'activeTab' permission is
  required" (checked October 14, 2026: an extension holding `http://127.0.0.1/*` and never granted
  `activeTab` was refused, and one holding `<all_urls>` took the screenshot of the same tab).

A click inside the sidebar grants nothing. With no access, the sidebar asks the person to click the
toolbar button while the page is showing. The extension never asks for wider access on its own.

A capture reads the active tab, does its work, and reads the active tab again. If the tab or its
address changed in between, the capture is dropped and the sidebar says the page changed, so a
screenshot is never labelled with another page's address.

## Limits

The sidebar checks each capture when it's taken, before anything is uploaded:

- A screenshot over 5 MiB is refused. Drafts live in `storage.local`, which Chrome limits to 10 MiB
  for the whole extension, and a screenshot is stored as base64.
- A message carries at most eight screenshots, the agents plugin's limit on attachments in one turn.
- A message carries at most eight links and selections, and their text together stays within the
  Node's 512 KiB limit on context in one turn.
- An empty selection is refused.

If browser storage is full when a capture is saved, the capture is dropped and the sidebar says so.

## Sending

**Send** works on the conversation the draft belongs to, even if the person switches away before it
finishes:

1. It records the send as pending, with its key and the IDs of the captures it carries.
2. It uploads each screenshot the Node doesn't hold yet with `attachment.upload`, and stores the
   attachment ID on that capture as soon as the Node answers.
3. It sends `turn.submit` with the text, the context parts, and the image parts.
4. When the Node accepts the turn, the sent captures and the text leave the draft. Anything captured
   or typed since stays.

A failed or uncertain step keeps the draft, the stored attachment IDs, and the pending key, and the
button reads **Retry**. A retry uploads only screenshots with no stored ID, and reuses the key while
the text and the captures are unchanged, so the Node answers with the turn it may already have made.
An upload needs no key: the agents plugin keeps one attachment per task and content, so uploading the
same screenshot again answers with the same attachment.

Removing a capture whose screenshot the Node holds deletes that attachment, unless another capture
in the draft is the same screenshot. The Node refuses to delete an attachment a turn sent, so a
capture that went with an uncertain send can't lose its picture. A sent capture leaves the draft
without a delete.

## Attachment operations

| Operation | Fields | Result |
| --- | --- | --- |
| `attachment.upload` | `nodeId`, `taskId`, `filename`, `mediaType` (`image/png` or `image/jpeg`), `data` (base64, at most 10 MiB decoded) | `{ nodeId, taskId, attachment }` |
| `attachment.read` | `nodeId`, `taskId`, `attachmentId` | `{ nodeId, taskId, attachment, data }`, with `data` null unless it's an image of at most 10 MiB |
| `attachment.delete` | `nodeId`, `taskId`, `attachmentId` | `{ nodeId, taskId, attachmentId, removed }`, with `removed` false for an attachment a turn sent |

`attachment` is the agents plugin's row: `id`, `taskId`, `filename`, `mediaType`, and `byteSize`. The
agents routes confine a task's own agent to its task, but the browser holds a device credential,
which they don't confine. So `attachment.read` and `attachment.delete` first read the row and refuse
an attachment of another task as `not_found`. An upload names its task in the route.

An upload goes in one request frame. Both browsers send messages of 64 MiB or more to a host, so the
host takes request frames up to 14 MiB, enough for one upload at the limit, and nothing is split. A
read comes back in reply chunks like any large reply.

## Sent screenshots in the conversation

`session.read` lists what a person's turn sent with its message, as `attachments: [{ id, image, name }]`,
and drops the `[Attachment: <id>]` lines that name them for the agent. A queued turn carries the same
list. The conversation reads each image once through `attachment.read` and shows it from an object
URL. Anything else shows its name. Leaving the conversation revokes every object URL it made, and a
read that answers after that makes none.

## Gaps

- Chrome's persistent site grant wasn't checked in a browser. Granting optional host access needs
  Chrome's own permission prompt, which a driver can't answer. The screenshot refusal on a granted
  site was checked with the site listed as required host access instead, which Chrome grants at
  install and reports the same way through `permissions.getAll`.
- In Firefox, `activeTab` from the toolbar button wasn't checked, because a driver can't click the
  toolbar. Firefox screenshots therefore weren't taken in a browser.
- A screenshot over 5 MiB wasn't produced in a browser; the largest was 3.7 MB.
- A selection inside a frame reads as empty, because captures read the top frame only.
- **Add to Acorn chat** wasn't clicked from a real menu, because neither CDP nor WebDriver BiDi can
  click a browser's own context menu. In Chrome, the background's click listener was run through
  `contextMenus.onClicked.dispatch` from the service worker, after the toolbar button granted
  `activeTab`: with the panel closed, the browser refused to open it and the draft was filled anyway,
  and with the panel open, the open composer showed the new chip. In Firefox, only the install was
  checked: the entry exists through the `contextMenus` alias. The `activeTab` grant from a menu click,
  the panel opening from it, and Firefox keeping the entry across a background restart rest on the
  browsers' documentation.

## Why

Captures stay in the browser until the person sends, so a capture someone removes never reaches the
Node. The Node owns the pictures once uploaded, which is why a retry reuses their IDs instead of
keeping a second store.

Captures sit under their own storage key, apart from the text, because the text is saved on each
keystroke and a screenshot can be megabytes.
