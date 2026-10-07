# Phase 05: terminal client

## Follow-up completion note, October 8, 2026

Pane-bearing task links now wait for the selected Node's loaded contribution preparation, under
the same 15-second deadline as plugin paths. Task links without a pane still use the compiled roster
immediately. A delayed pane-registration test opens the contributed pane after readiness; an
unavailable-pane test simulates the deadline releasing navigation and confirms its refusal path.

The shell cancels a deferred link request when it unmounts, checks that the selected Node still
matches the requesting shell before applying it, and reports a live import failure. A stale-request
test covers disposal and Node selection change. For a project or task in another workspace, the
shell switches workspace before resolving the link. Project source visibility is then checked
against that workspace's loaded provider scope, so a hidden source falls back to the project with a
notice. Focused tests cover remembered destination tasks and sources, an available source, and a
source hidden in the destination workspace. The first-frame closure remains below its unchanged
723,000-byte guard at 722,959 bytes across 164 chunks.

TUI and client-core scoped TypeScript checks, the TUI build, focused link, source-switch, chrome,
and workspace-focus tests, and targeted oxlint passed. The architecture suite passed 86 of 87
checks; its only failure remains three missing generated Tauri schemas cited by the unrelated
desktop security design. No full repository gate or release build ran in this follow-up.

## Completion note, October 8, 2026

`acorn --link` parses a pure address before opening a Node. It rejects malformed links, `--task` or
`--node` combinations, and `new-task` with nonzero exits. A concrete Node ID must already be in the
terminal's fleet; link startup never pairs. `local` keeps the normal local data-root behavior, except
that attaching without a saved token refuses instead of asking for a pairing code.

The terminal opens task, pane, project, settings, and rail-source destinations after place restore,
queries, and source registration settle. A link wins over a remembered task or source. Plugin paths
and outside URLs wait for the selected Node's loaded contributions, with a 15-second deadline that
also covers a starting Node's handshake. The terminal resolves outside URLs through its registered
content-link recognisers. It opens a route only when a terminal source renders it. A plugin page
without a terminal view opens its project and names the unavailable page; an unclaimed URL or a
recogniser with only a reference panel receives a refusal. Source IDs select the rail, while
provider IDs remain the recogniser's concern. Project path segments are decoded by the address
parser and encoded once for the router.

The isolated `tui-navigation` session showed the linked Notes pane, project, Connections settings
page, and Agents source in snapshots. A pull route without a connected GitHub source fell back to
its project and wrote an unavailable-page notice. A registered test recogniser reached its terminal
source, and a registered project surface without a terminal source produced the specific refusal.
The fixture cannot show a live GitHub pull or loaded plugin page. Settings sections do not scroll in
this host, and desktop-only settings controls continue to say so. Every isolated session was stopped.

The TUI build and scoped TypeScript checks for TUI and client-core passed. The first-frame startup
closure measured 722,619 bytes in 164 chunks; its guard moved from 720,000 to 723,000 bytes for the
pure parser and rail identity work. The roster and linked-place resolver remain after first frame.
The scoped TUI run passed 670 tests, with the boot file unable to bind loopback in the sandbox; its
10 tests passed on a narrow host-permission rerun. Focused link, chrome, source-switch, and startup
budget tests passed. The architecture run passed 86 of 87 tests; its only failure names three
missing generated Tauri schemas in the unrelated desktop security design, which desktop staging
generates. Malformed, unpaired, action, conflicting-option, and empty links returned the expected
messages and nonzero codes in direct startup checks. The coordinator owns full repository gates and
installed release checks.

Later work can add terminal renderers for plugin pages and reference-panel content links. It should
keep the link resolver behind the first frame and retain the no-pairing and no-write startup rules.

Date: October 8, 2026. Status: implemented. Dependencies: phase 01.
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
