# 09-10. The description's copy button sits on a line of its own

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The pull request description's copy button is a bare 16-pixel glyph on a line of its own above the
text, which leaves a 27-pixel gap under the section header. `Sections` already has an `actions` member
for exactly this case.

## Where to see it

GitHub with the area 09 seed › #42 › **Description**.

## The fix

The partial fix. A markdown heading scale and task-list ticks change the kit's `Markdown`, which draws
the agent transcript, and `SanitizedHtml`, which draws measured diff threads. Both are deferred (see
[deferred.md](../deferred.md)).

- `plugins/github/src/client/pullDetail/prSections.tsx:27-40, 199-203`: the copy button goes in the
  section's `actions`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `prSections.tsx:201` | Description | Keep | |
| `prSections.tsx:31` | Copy description | Keep | Moves to the section's actions. |

## Risk and checks

- Before you start, check what the section's `actions` slot draws on the terminal host (`Sections`
  draws as tabs there).
- Screens: #42's description.
- Tests: `plugins/github`.
