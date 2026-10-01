# 11-8. The API detail: md controls in a bar, and the name in an 11-pixel button

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The API request bar holds a 32-high method select, URL input, and **Send**, where every other chrome bar
holds 26-high controls. The header has no title: the request's name is in a second bar as a bare button
11 pixels high, beside a lower-case "task" eyebrow and an unlabelled accent dot for unsaved changes. The
tab strip sits inside two `Stack`s, so no bar rule can reach it.

## Where to see it

The API pane on a task: a new request, then one sent to area 11's local server.

## Already done

- K2's P8 pulls a second bar or tab strip in a remote tree's detail up against the first, so the
  request bar and the status strip no longer have a gap.
- K2's 10-7 lets a pulled-out tab strip reach the right edge.
- K1a's chrome rule leaves a bar that holds an input alone, on purpose: forcing **Send** to 26 beside 32
  high fields misaligned them. Shrink the select, input, and button together at the call site.

## The fix

- `plugins/http/src/tree/HttpDetail.tsx:27-50`: the method select, URL input, and **Send** at sm.
- `HttpDetail.tsx:52-72`: the name bar is one `Toolbar size="sm"`: the name as a ghost sm button
  ("Untitled request"), and "In this task" and **Unsaved** as `Badge`s, in place of the eyebrow and the
  dot.
- `plugins/http/src/tree/RequestTabs.tsx:153-176`: `Tabs` is a direct child of the region.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `HttpDetail.tsx:37` | {{BASE_URL}}/users  ·  or paste a curl command | Rewrite | {{BASE_URL}}/users, or paste a curl command |
| `HttpDetail.tsx:55` | Rename, move or file this request (`title`) | Rewrite | tip "Rename, or save to the project" |
| `HttpDetail.tsx:59` | Untitled request | Keep | |
| `HttpDetail.tsx:60` | task (eyebrow) | Rewrite | In this task (a `Badge`) |
| `HttpDetail.tsx:64` | Unsaved changes (dot label) | Rewrite | A `Badge` "Unsaved" |
| `RequestTabs.tsx:43` | Overrides for this request only. Repo variables (including secrets and command-derived ones) are set in the Variables tab and apply everywhere. | Rewrite, keep inline | Values here replace the project's variables for this request only. |
| `RequestTabs.tsx:62` | No authentication. Anything you need can also be set directly as a header. | Rewrite | This request sends no credentials. You can also add an Authorization header on the Headers tab. |
| `RequestTabs.tsx:117` | Whichever mode you pick, this becomes a header (or a query param) when the request is sent — you can see exactly what went out in the response Timeline. | Rewrite, keep inline | acorn sends this as a header or a query parameter. The response's Timeline shows what was sent. |
| `RequestTabs.tsx:168` | none / json / text / form-urlencoded | Rewrite | None / JSON / Text / Form (URL-encoded) |
| `RequestTabs.tsx:173` | none / basic / bearer / API key | Rewrite | None / Basic / Bearer token / API key |
| `RequestTabs.tsx:180` | Query parameters are part of the URL — editing either side keeps the other in step. | Remove | |
| `RequestTabs.tsx:190` | This request has no body. | Keep | |
| `plugins/http/acorn-plugin.config.mjs:82, 95, 108, 133, 145` | API / API requests / API requests / API / Saved HTTP requests | Rewrite | Keep "API" as the short switcher and rail label. Use "API requests" wherever a noun is needed, including the context row ("Saved API requests"). |
| `plugins/http/src/tree/app.tsx:52` | This surface needs a project. Open it from a task or from a project's rail. | Rewrite, `EmptyState` | Title: "No project". Body: "Open this from a task or a project." |
| `app.tsx:56` | Loading project… | Keep | |
| `app.tsx:61` | Could not load this project. | Rewrite | Couldn't load this project. (Add **Try again**.) |

## What earlier batches give you

- **`Badge`** for "In this task" and **Unsaved**, so the state reads without a hover.
- **Two bars in a remote tree** (K2's P8).

## Risk and checks

- Before you start, measure the request bar and confirm all three controls change together.
- Tree panes cannot fill a header's `actions` slot (11-7, deferred), so the Body and Auth mode selects
  keep their own row.
- Screens: a new request, a 200 response, params, and save.
- Tests: `plugins/http`. Rebuild the http bundle.
