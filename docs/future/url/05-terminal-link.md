# Phase 05: terminal client

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: phase 01.
Read the [plan](./README.md), especially [the address format](./README.md#the-address-format).

## Deliverable

`acorn --link <link>` starts the terminal client open at the place an `acorn://` link names. It is the
terminal's way to open a link someone shared, the same way `--task` opens a task.

## Steps

1. Add a `link` string option beside `task` in `apps/tui/src/main.tsx`. Refuse it alongside `--task`
   or `--node`, because the link already names both.
2. Parse it with phase 01's `parseLink` before the client connects, so a malformed link exits with a
   usage error and the reason.
3. Pick the Node from the link's Node slot, the way `--node` does. `local` means the local Node. An
   unpaired Node exits with the same connection error `--node` gives.
4. Open the place once the client has routed: a task and its pane, a project path, a settings page, or
   a rail source. `open` resolves through the content-link recognisers the terminal client registers.
5. Refuse `new-task` with a message to open the link in the desktop. The terminal client has no
   promote dialog to confirm with.
6. Add `--link` to the help text and to `docs/tui/process.md`.

## Acceptance

- Each navigation form opens the right place in a `pnpm dev:tui:agent` session, checked with a
  snapshot.
- A malformed link, an unpaired Node, and a `new-task` link each exit with a clear message and a
  non-zero code.
- The terminal suite passes, plus `pnpm lint`.

## Verify before building

- Which places the terminal client can show. A plugin page with no terminal view needs its own
  refusal message.
- Whether the content-link recognisers register in the terminal client, which decides whether `open`
  works there.
