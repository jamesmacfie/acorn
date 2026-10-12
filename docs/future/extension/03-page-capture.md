# Phase 03: page capture

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Page capture](../../browser-extension/page-capture.md)
owns the shipped contract.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Agent conversation](./02-agent-conversation.md).

## Deliverable

Capture an ordinary webpage into a reviewed agent draft and explicitly send it to the selected
conversation.

## Starting point and owners

- `plugins/agents/src/server/routes/managed.ts` owns task-scoped attachment upload, content reads,
  and draft deletion.
- `plugins/agents/src/client/composer/submitOperation.ts` shows attachment input parts and
  submission behavior.
- Read [attachment limits](../../managed-agents/attachments.md) and [draft
  ownership](../../managed-agents/composer.md).

## Implementation steps

1. Add explicit URL, selected-text, and visible-tab screenshot controls. Use temporary access from
   browser gestures; explain the toolbar action when a sidebar gesture cannot supply capture access.

2. Keep captures local until send. Show the captured source URL, selected text, screenshot preview,
   and concrete task/session destination. Allow removing each capture. Do not add crop or annotation
   tools.

3. Persist the draft in browser-local storage with the selection key from phase 02. Bound text and
   image sizes using the agent API's documented limits and the browser storage quota. Report an
   oversized capture before starting an upload.

4. Add native attachment upload/read/delete operations without introducing a generic binary-fetch
   proxy. Bound multipart and native transfer bytes. Preserve task scope on every operation.

5. On explicit send, upload confirmed images and submit their IDs with the ordinary interactive
   turn. Persist successfully uploaded IDs before the turn submission so a retry reuses them. Delete
   only abandoned draft attachments, never already submitted conversation attachments.

6. Bind capture to the visible tab and verify the tab/page has not changed while the screenshot is
   being taken. Preserve the originating node, task, and session during upload and submission.

7. Display transcript attachment previews through the task-confined native operation. Clean up
   object URLs and incomplete transfers when a view is disposed.

## Demo and acceptance

On a website without a provider plugin, add its URL, selected text, and a screenshot. Remove one
capture, close/reopen the sidebar, then send and inspect the same message from another client.

- Assert that capture and preview alone do not upload content to Node or enqueue a turn.
- Change the active tab during screenshot capture; reject or retry instead of mislabeling the
  captured image.
- Verify size limits, upload failure, uncertain send, reused attachment IDs, and draft removal
  without deleting submitted attachments.
- Switch node/session while capture or upload is pending; preserve the original destination and
  draft.

## Verify and complete

Run attachment route tests, extension capture/draft tests, affected suites, and lint. Capture from
both Chrome and Firefox with temporary access and with a persistent grant.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at URL, selected text, and visible screenshots. Do not add full-page stitching, DOM scraping,
form extraction, annotation, or a separate capture library.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- Uploads aren't chunked. Chrome sends up to 64 MiB to a native host and Firefox up to 4 GiB; the
  256 KiB request cap was the host's own. The host takes request frames up to 14 MiB, enough for one
  10 MiB upload as base64, and its frame reader gathers pipe reads without copying the frame on each
  one. Replies to the browser keep their chunking, because the browser caps those at 1 MiB.
- An upload carries no retry key. The upload route ignores `idempotency-key`, but the agents plugin
  keeps one attachment per task and content, and revives a swept one under the same ID. So uploading
  the same screenshot again is the retry, and an uncertain upload can't make a second copy.
- Links and selections are the agents plugin's `context` parts, with `source: 'browser-extension'`, not text in
  the message. The Node wraps a context part in an escaped block, which is the right treatment for
  page text. `turn.submit` takes `input`, limited to `text`, `context`, and `image` parts.
- `attachment.read` and `attachment.delete` read the attachment's row first and refuse another task's.
  The agents routes confine only a task's own agent, and the browser holds a device credential.
- The toolbar button opens the panel through the background's own click handler. Measured in Chrome
  155: with `openPanelOnActionClick`, the click opens or closes the panel and grants no `activeTab`,
  and a click inside the panel grants nothing either. Firefox opens the sidebar instead of toggling
  it, so both browsers keep the panel up on a second click.
- Screenshots are JPEG at quality 90, capped at 5 MiB, because drafts live in `storage.local`, which
  Chrome caps at 10 MiB for the extension. Captures sit under their own `captures:` key so a
  keystroke doesn't rewrite them.
- The capture check compares the tab's ID and full address before and after. A page that changes its
  own `#hash` during a capture is refused too; that is stricter than needed, and safe.
- In Firefox a granted site allows the link and the selection, but not a screenshot: Firefox wants
  `activeTab` or `<all_urls>`. A refused screenshot gets its own message pointing at the toolbar
  button.
- Sent screenshots show in the transcript through `attachment.read`, read once each per open
  conversation. A long conversation with many screenshots reads them all while it's open.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40, Firefox 151.0.3, and web-ext 10.7.0 on macOS. Chrome
session `p03-chrome` ran through `pnpm dev:extension`. Firefox through `pnpm dev:extension`
(`p03-firefox`) failed as in phases 01 and 02: web-ext's read of
`~/Library/Application Support/Firefox/profiles.ini` is denied in the agent sandbox. The Firefox checks
ran in `p03-firefox-bidi`: the development build, the host registered with
`acorn browser install --development`, Firefox started with `open`, the extension installed over BiDi,
and the Node of `p03-chrome`. The test site was a plain local page with no provider plugin. Chrome's
real side panel was opened with CDP's `Extensions.triggerAction`, Firefox's real sidebar with a real
click on a button that calls `sidebarAction.open()`. "Another client" was a second device paired to the
Node, calling its HTTP routes. Turns ran on Codex.

| Check | Chrome | Firefox |
| --- | --- | --- |
| No access: capture refused with the toolbar guidance | Passed | Passed |
| A click inside the panel grants no access | Passed (measured) | Not checked |
| Toolbar click opens the panel and grants `activeTab` | Passed, through `triggerAction` | Gap |
| Link, selection, and screenshot with temporary access | Passed | Gap |
| Link and selection with a persistent site grant | Gap | Passed |
| Screenshot with a persistent site grant | Gap | Refused by Firefox; own message shown |
| Capture and preview upload nothing and start no turn | Passed | Passed |
| Remove a capture, close and reopen the panel, draft restored | Passed | Passed |
| Send: one turn with text, context, and image; the other client reads the same input | Passed | Passed, link and selection |
| Agent answered from the screenshot and the selection | Passed | Not checked |
| Sent screenshots drawn in the transcript through `attachment.read` | Passed | Passed, Chrome's screenshots |
| Page address changes during a screenshot: nothing kept | Passed | Not repeated |
| Tab switched during a screenshot | Switch landed before or after the capture every time; no mislabelled image | Not repeated |
| Upload answer lost: Retry, one attachment, one turn | Passed | Not repeated |
| Turn answer lost after upload: Retry reuses the stored ID, no second upload or turn | Passed | Not repeated |
| Switch conversation while a send is held: lands in the first, the second's draft kept | Passed | Not repeated |
| 3.7 MB screenshot uploaded in one frame | Passed | Not repeated |
| Delete refuses a sent attachment, deletes a draft, refuses another task's | Passed | Not repeated |

These gaps remain:

- Chrome's persistent site grant. `permissions.request` opens Chrome's own prompt, which CDP can't
  answer, and Chrome's settings page grants only host access a manifest declares, not optional
  access.
- Firefox's toolbar button, and so `activeTab` and Firefox screenshots. WebDriver BiDi can't click
  the toolbar.
- Chrome's toolbar button was clicked through CDP's `Extensions.triggerAction`, not by a person.
- A tab switch was never landed inside a screenshot, which takes under 60 ms; unit tests cover it,
  and the address-change check above passed in Chrome.
- A screenshot over 5 MiB. The largest this display produced was 3.7 MB.
- A Node switch during a capture or send wasn't checked, in a browser or a unit test. It unmounts the
  conversation the same way the session switch above does.
- Firefox reload on save and session stop through `pnpm dev:extension`, for the sandbox reason above.
- Firefox's first native port after start stalled again; the 10-second deadline recovered it.
