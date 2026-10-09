# Phase 03: page capture

Status: planned, October 10, 2026.

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
