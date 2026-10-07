# Acorn links

This plan adds an `acorn://` link scheme that opens the desktop app on a task, a project page, a
plugin page, a settings page, or a rail source. Read it before you build a phase. It holds the
decisions the phase files depend on.

Date: October 7, 2026. Status: planned; implementation not started. A browser extension that builds
these links is out of scope and has its own plan.

## Goal

Let something outside Acorn, such as a note, a chat message, a shell script, or a browser extension,
open Acorn at a specific place. Let a person copy a link to where they are. Reuse the addresses the
app already routes on, so a plugin page can be linked to without the plugin doing anything.

## The address format

Every link has a Node, then a place:

```text
acorn://<node>/t/<taskId>[?pane=<paneId>&item=<itemId>]
acorn://<node>/p/<projectId>[/<rest of a project path>]
acorn://<node>/settings[/<pageId>][#<sectionId>]
acorn://<node>/source/<sourceId>
acorn://<node>/open?url=<encoded http or https URL>
acorn://<node>/new-task?url=<encoded http or https URL>
```

| Form | What it opens | What it reuses |
| --- | --- | --- |
| `t/` | A task, optionally with a pane and an item selected | `TASK_ROUTE` and the pane query in `packages/client-core/src/features/tasks/taskDeepLink.ts` |
| `p/` | A project, or any page under it, including plugin pages | `PROJECT_ROUTE` and the plugin prefix in `packages/client-core/src/host/registries/commands/corePaths.ts` |
| `settings` | The Settings layer at a page and section | The `settings/<pageId>#<sectionId>` target and the `presentation:open-settings` event |
| `source/` | A rail source, such as Agents or Pulls | `setSelectedSource`, the function the bell's `source` target calls |
| `open` | Whatever Acorn has for an outside URL | `openInAppUrl` in `packages/client-core/src/host/registries/panes/contentLinks.ts` |
| `new-task` | A task for an outside item, after you confirm | The source's `promotion` contract and `PromoteToTaskModal` |

The first five forms only go somewhere. `new-task` is the one action, and it always asks first.

## Decisions

- **The Node slot holds the Node's ID.** IDs don't change when a Node is renamed. `local` is an alias
  for the bundled Node, the one `homeNode()` returns. A link never uses a Node's label.
- **A link to a different paired Node switches to it.** A link to a Node this device hasn't paired
  with shows an error. A link never starts pairing.
- **Only core addresses are stable.** Acorn keeps `t/`, `p/<projectId>`, `settings`, `source/`,
  `open`, and `new-task` working across releases. Paths a plugin adds under `p/<projectId>/` are best
  effort. A link to a plugin page that doesn't exist opens the project and says what was missing.
- **Copy link produces the exact path.** It writes the active Node's ID, not `local`, so a link pasted
  on another machine fails with a clear error instead of opening the wrong Node's data.
- **Outside tools use `open` and `new-task`.** A browser extension knows a GitHub URL, not Acorn's
  project ID. The content-link recognisers already turn one into the other.
- **Dev builds don't register the scheme.** Only the installed app does, so links never open a dev
  build by surprise. Agent-driven sessions feed links to the handler directly.
- **`acorn://` means only this.** The MCP resource experiment uses bare names such as `pr://` and
  `task://context` instead ([resource reads](../pi/07-resource-reads.md)).

## Safety rules

Any web page can open an `acorn://` link without asking, so treat every link as untrusted input:

- Parse every link in one pure function, and decode each value once.
- Open navigation forms at once. Show the confirm dialog for `new-task` every time a task would be
  created.
- Never run a palette command, send an agent prompt, start a workflow, or pair a Node from a link.
- Accept only `http` and `https` URLs in `url=`, and cap the link's length.
- Say why a link was refused. Don't drop it silently.

## How existing addresses map in

Acorn names places five ways. The link scheme reuses each one rather than adding a sixth:

| Existing address | Where it lives | Link form |
| --- | --- | --- |
| Router paths | `apps/desktop/src/client/index.tsx`, `corePaths.ts`, plugin `routes` | `t/` and `p/` |
| Settings targets | `docs/frontend/settings.md` | `settings` |
| Rail source selection | `selectedSource()` in `packages/client-core/src/features/tasks/tasks.ts` | `source/` |
| Notification targets | `NoticeTarget` in `packages/protocol/src/chrome/notices.ts` | None. They point at the same places through the forms above. |
| Content links | `packages/client-core/src/host/registries/panes/contentLinks.ts` | `open` and `new-task` |

Notification targets and named content targets are nearly the same shape, a kind plus an item. Merging
them is worth doing, but it is separate cleanup and this plan doesn't depend on it.

## Implementation order

Build the phases in order. Each file states its dependencies, deliverable, and acceptance checks.

| Phase | Deliverable | Dependencies |
| --- | --- | --- |
| [01: addresses](./01-addresses.md) | A pure parser and builder, and a dispatcher that opens an address inside the app. | None |
| [02: desktop registration](./02-desktop-registration.md) | macOS opens `acorn://` links in the installed app, including at a cold start. | 01 |
| [03: copy link](./03-copy-link.md) | **Copy link** on tasks, project pages, plugin pages, settings pages, and rail sources. | 01 |
| [04: new task action](./04-new-task-action.md) | `new-task?url=` opens the promote dialog for a recognised outside item. | 02 |
| [05: terminal client](./05-terminal-link.md) | `acorn --link <link>` opens the terminal client on a navigation form. | 01 |
| [06: documentation](./06-documentation.md) | The reference page for the shipped scheme, and the index updates. | 02, 03, 04, 05 |

[Refused alternatives](./refused.md) records what this plan decided not to do, and why.

## Verify before building

- Node IDs are valid lowercase URL hosts. URL parsers lowercase the host, so an ID with capitals
  would not round-trip.
- How Tauri's deep-link plugin delivers a link on macOS at a cold start and when the app is running,
  and whether it registers anything for an unbundled dev build.
- Whether navigating to a project in another workspace switches the workspace, or needs a step first.
- Which sources contribute a `promotion`. GitHub, agents, and docker do. Check Linear before
  promising Linear issues in phase 04.
