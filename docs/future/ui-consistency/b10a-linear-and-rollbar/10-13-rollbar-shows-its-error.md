# 10-13. A Rollbar item hides the error two clicks away

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A Rollbar item's Overview is six facts, all in mono. The message and the stack are under
**Occurrences**, then a click on an occurrence. Every occurrence row is titled "TypeError" and the
chosen row is never marked, so you cannot tell which one you are reading. The occurrence detail never
shows the error message, and the request URL wraps mid-word. "What broke, and where" is the whole reason
to open an error.

## Where to see it

Rollbar item #1042 with the area 10 seed: Overview, Occurrences, and one occurrence.

## The fix

- `plugins/rollbar/src/tree/app.tsx:48-84`: Overview also loads the newest occurrence. The node's
  `/items/:identifier` composite already builds it.
- `plugins/rollbar/src/tree/RollbarItemView.tsx:80-192`:
  - Overview shows the message and stack under the facts.
  - Occurrence rows take the time as title, environment and version as meta, and `selected`.
  - The header shows `exceptionClass: message`.
  - Mono only for versions and hosts.
  - A "›" mark on the thrown line in the `CodeBlock` string.
  - The request URL wraps at word boundaries.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `RollbarItemView.tsx:72` | Overview / Occurrences | Keep | |
| `RollbarItemView.tsx:83-88` | Occurrences / First seen / Last seen / Framework / Assigned to / Resolved in | Keep | |
| `RollbarItemView.tsx:96` | No occurrence sample is available. | Rewrite | Rollbar has no recent occurrences for this error. |
| `RollbarItemView.tsx:131` | Choose an occurrence to inspect its stack. | Rewrite | Title: Choose an occurrence. Body: Its stack trace shows here. |
| `RollbarItemView.tsx:134` | Loading occurrence… | Keep | |
| `RollbarItemView.tsx:137` | Could not load the occurrence. | Rewrite | Couldn't load this occurrence. |
| `RollbarItemView.tsx:171` | Copy context | Rewrite | Copy details (tip: "Copies the error, stack, and request as text for an agent or a ticket.") |
| `RollbarItemView.tsx:155-158` | Request / Context / Server | Keep | |

The mono and fallback words are [10-20](./10-20-smaller-defects.md) items e and f.

## Risk and checks

- Before you start, confirm the composite route returns the newest occurrence's message and stack.
- The occurrences split is nested inside a tab panel. K2's 10-8 made the detail keep its inset in that
  case; check it still does.
- Screens: #1042's Overview, Occurrences, and one occurrence.
- Tests: `plugins/rollbar`.
