# Ticket 4: reference docs

Status: proposed, October 14, 2026. Depends on [ticket 3](./03-screenshot.md). Read
[the context doc](./README.md) first.

## Goal

The shipped behaviour is described in `docs/browser-extension/`, and this folder is removed.

## Build

1. Add an "Ask Acorn about an element" section to `docs/browser-extension/page-capture.md`: how to
   start it, what the agent receives, the cleaning rules, the trust checks, and the key-event limit.
2. Add **Ask about an element** to the chip menu in `docs/browser-extension/handoffs.md` and the
   marker menu in `docs/browser-extension/task-pages.md`.
3. Add `askAgent:<nodeId>` to the browser storage list in `docs/browser-extension/conversations.md`.
4. Delete `docs/future/element-picker/` and its row in `docs/future/README.md`.

## Done when

- The reference pages describe what shipped, including anything tickets 1 to 3 changed from this plan.
- `pnpm lint` passes its documentation path checks.
