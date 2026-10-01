# 06-9. The HTTP variable editor uses raw kind words and a far-away add button

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

API requests' variable rows are a hand-built line: a 12-pixel checkbox, two inputs named only by
placeholders, a select showing the raw kinds `value`, `secret`, and `command`, a per-row **Save**, and
a trash icon. **+ Variable** sits right-aligned at the far end of the page. A person reads the kind
select as code, and has to look across the page to add a row.

## Where to see it

Settings › API requests (http plugin, a remote tree). Pick a project, then add a variable. The same
`HttpVariables` component also mounts inside the API pane's **Variables** view in a task. Check both.

## The fix

This is the partial fix. Moving HTTP variables and MCP env rows onto `KeyValueEditor` is deferred: it
needs a password column and a switch from per-row save to whole-list save (see
[deferred.md](../deferred.md)).

- `plugins/http/src/tree/HttpVariables.tsx`, around `:110`: Kind options read **Text**, **Secret**,
  **Command**.
- Around `:141-145`: **Add variable**, left-aligned, under the list.

## Copy

Rows 779 to 781 (the page's heading and the `{{NAME}}` help) wait with 06-16, because the heading and
help belong to the shared `HttpVariables` and its settings mount is deferred.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `HttpVariables.tsx:18` | Used exactly as typed. | Keep | |
| `HttpVariables.tsx:19` | Encrypted at rest. Leave blank when editing to keep the stored value. | Rewrite | Stored encrypted. Leave it blank to keep the saved value. |
| `HttpVariables.tsx:20` | Run in the task worktree when a request uses it. The last line of output is the value. | Rewrite | Runs in the task's worktree when a request uses it. The last line it prints is the value. |
| `HttpVariables.tsx:110` | value / secret / command (kind options) | Rewrite | Text / Secret / Command |
| `HttpVariables.tsx:116` | stored — leave blank to keep (placeholder) | Rewrite | Saved. Leave blank to keep it. |
| `HttpVariables.tsx:143` | + Variable | Rewrite | Add variable |

## Already done

- K1a gave the delete its armed label, **Delete variable?**.

## Risk and checks

- Before you start, confirm the stored kind values do not change. Only the option labels change.
- The http plugin is loaded. Rebuild its bundle to see the change, and restart the node if the
  server side moved.
- Screens: Settings › API requests with one variable, and the API pane's Variables view.
- Tests: `plugins/http`.
- [11-18](../b11-tool-panes/11-18-smaller-defects.md) gives the same rows input labels.
