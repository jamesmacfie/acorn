# 11-12. The API response: an invisible copy button, and a timeline in tiles with machine labels

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The response's **Copy body** button is in the page but has `opacity: 0`: `CopyButton` shows only under a
`.copyable` ancestor unless it gets `always`, and a tree cannot set that class. Headers and Timeline are
`Facts` in the default tile grid, six tiles across, for long values. The timeline labels are the node's
kind ids in the label treatment: "REQUEST", "RESPONSE-HEADER" seven times, "INFO".

## Where to see it

The API pane: send a request to area 11's local server, then read **Body**, **Headers**, and
**Timeline**.

## Already done

- K4a's 11-3 made the host draw a number in tree text, so the status pill reads "200 OK" and the time
  reads "{n} ms" again. Building those two runs as template strings in `ResponseView.tsx` (`:68, 70, 128`)
  was left for this batch; it is belt and braces for older hosts. Do it while you are here.

## The fix

- `plugins/http/src/tree/ResponseView.tsx:83`: `CopyButton always`, with its tip "Copy body".
- `ResponseView.tsx:44, 97`: the Timeline and Headers `Facts` take `grouping="rows"`.
- `plugins/http/src/server/send.ts:379-403`: header rows are labelled by the header's name, grouped under
  "Sent" and "Received", with the labels below.
- Check the http tests for asserted labels.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ResponseView.tsx:73` | redirected | Rewrite | Redirected |
| `ResponseView.tsx:76` | truncated at 5 MB | Rewrite | Cut off at 5 MB |
| `ResponseView.tsx:83` | Copy body | Keep | As a visible tip. |
| `ResponseView.tsx:91` | Empty response body. | Rewrite | The response has no body. |
| `ResponseView.tsx:127` | Network error | Keep | |
| `ResponseView.tsx:172` | Sending… / No response yet — press Send. | Rewrite | Sending… / Send the request to see the response. |
| `send.ts:380-403` (timeline labels) | request / request-header / response / response-header / info / error / error-detail | Rewrite | Request / Sent header / Status / Header / Size and time / Error / Detail (each header row labelled by its name once the list is rows) |
| `send.ts:382` | {n} bytes in {n}ms | Rewrite | {size} in {n} ms (reuse `formatSize`) |

## Risk and checks

- Before you start, confirm `CopyButton` takes `always` through the tree's props.
- `send.ts` is node-side. Restart the node to see the timeline change.
- Screens: a 200 response, its headers, its timeline, and a network error.
- Tests: `plugins/http`. Rebuild the bundle.
