# Page capture in the browser extension

This page covers how the [browser extension](../browser-extension.md) captures a page's link, its
selected text, or a screenshot into a conversation's draft, and sends them with a message. It also
covers the attachment operations on the native bridge and how a sent screenshot shows in the
conversation. The sidebar code is in `apps/extension/src/sidebar/`: `capture.ts` reads the page,
`Composer.tsx` owns the draft and the send, and `attachmentPreviews.ts` draws sent screenshots. The host
side is in `apps/cli/src/browser/bridge.ts`.

## What a capture is

The composer's toolbar has three icon buttons, named by these labels:

| Button | What it keeps | What the agent receives |
| --- | --- | --- |
| **Add page link** | The tab's address and title | A `context` part labelled `Page: <title>`, holding the title and address |
| **Add selected text** | The page's selected text, with its address and title | A `context` part labelled `Selected text from <title>`, holding the address and the text |
| **Add screenshot** | A JPEG of the visible tab at quality 90, with its address and title | An `image` part naming the attachment the Node holds for it |

The parts are the agents plugin's own turn input ([attachments](../managed-agents/attachments.md)).
The Node hands a `context` part to the agent inside an `<acorn-context source="browser-extension">` block, with
its content escaped so page text can't close the block and read as the person's own words. Captures
read the top frame of the active tab in the sidebar's window, and nothing else: no full page, no
form contents, no other tabs.

Each capture shows as a chip in the draft, with a thumbnail for a screenshot. Opening a chip shows its
address and its selected text or item context, and **×** removes it. A line under the composer names
the conversation and task the message goes to. Capturing and reviewing send nothing to the Node.

## Page access

The extension asks for `activeTab` and `scripting`, and lists `http://*/*` and `https://*/*` as
optional host access, so it holds no site at install. A capture works when the browser lets the
extension read the active tab:

- **The toolbar button.** Clicking the Acorn button opens the sidebar and grants `activeTab` for that
  tab, until it navigates. The background handles the click itself, because Chrome's own
  open-on-click opens the panel without granting `activeTab`.
- **A granted site.** A site the person granted reads without the toolbar button. In Firefox this
  covers the link and the selection, but not a screenshot: Firefox takes one only with `activeTab` or
  `<all_urls>`.

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
  Chrome's own permission prompt, which a driver can't answer.
- In Firefox, `activeTab` from the toolbar button wasn't checked, because a driver can't click the
  toolbar. Firefox screenshots therefore weren't taken in a browser.
- A screenshot over 5 MiB wasn't produced in a browser; the largest was 3.7 MB.

## Why

Captures stay in the browser until the person sends, so a capture someone removes never reaches the
Node. The Node owns the pictures once uploaded, which is why a retry reuses their IDs instead of
keeping a second store.

Captures sit under their own storage key, apart from the text, because the text is saved on each
keystroke and a screenshot can be megabytes.
