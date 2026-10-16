# Rework the browser extension's sidebar

Date: October 16, 2026. Status: proposed. Implementation not started.

This folder turns the clickable prototype at `references/extension-ux/acorn-extension-ux.html` into
thirteen phases a developer can pick up one at a time. The last is optional. Read this page first. It says how to read the
prototype, what holds across every phase, and the order to work in.

The shipped behavior lives in [the browser extension reference](../../browser-extension.md) and its
topic pages. Where this plan and a reference page disagree about how something works today, the
reference page wins. Recheck each phase's starting point against the checkout before you begin.

## The problem

The sidebar has a hidden subject. Agents, Workflows, and plugin tabs show "the page's task, or the
current task on its project's site", and nothing on screen says which task that is. Most of the
clutter traces back to that: the **Current task** section on Home, the "This page belongs to no
task. Choose one under Home." line, and bottom tabs that appear and vanish as you browse.

The prototype makes the subject visible. The top bar names the task, and everything under it belongs
to that task.

## Read the prototype

The prototype is one self-contained HTML file. Open it in a browser. It has three columns:

- On the left, a list of scenarios, grouped as "Start here", "Get connected", "Home", "A task",
  "Moving around", "Settings", and "On the page". Each phase names the scenarios it builds.
- In the middle, a fake Chrome window with the sidebar on the right. Everything in the sidebar is
  clickable, and the browser tabs above the page switch the page beside it.
- On the right, the design notes for the scenario. Each has a **Changes** list against today's
  sidebar. A note marked as needing a bridge operation, or as a decision, says so in a box.

The top bar of the prototype switches the theme and the style pack, so you can check a screen in
both packs.

`references/` is in `.gitignore`. Get the file from the plan's owner if your checkout doesn't have it.
Screenshots of today's sidebar sit beside it in `references/extension-ux/today/`, numbered `01` to
`20`. The prototype calls these the "before" pictures, and each phase lists the ones it replaces.

### Where things are in the file

The prototype's script is plain JavaScript that builds HTML strings. Each phase cites the function
that draws its screen, with its line in the HTML file. These are the ones most phases need:

| Line | What it is |
| --- | --- |
| 76 to 357 | The sidebar's CSS: Acorn's tokens and the Terminal pack, with the Modern overrides from line 94 |
| 496 to 634 | The fake world: Nodes, workspaces, projects, agents, workflows, items, pages, tasks, sessions, requests, and runs |
| 636 to 656 | Navigation: `openTask`, `openConv`, `goHome`, and `goPage`, the rule for following the browser tab |
| 658 to 740 | `SCENARIOS` and `SETUP`, the state each scenario starts from |
| 742 to 802 | `topBar`, `tabStrip`, and `strip`, the chrome above each view |
| 804 to 1066 | The views, one function each, from `bridgeView` to `siteModal` |
| 1080 to 1166 | Overlays: `pickerSpec`, `pickerView`, `switcherView`, `needsOverlay`, and `menuView` |
| 1168 | `sidebar`, which composes a view from its parts |
| 1184 to 1250 | The page: the task chip, its menus, the branch marker, and the ask box |
| 1256 to 1336 | `NOTES`, the right-hand notes for each scenario |
| 1423 to 1578 | Actions: answering, sending, creating a task from an item, and the click handlers |

The line numbers are for the file as it was on October 16, 2026. If the file changes, search for
the function name.

## What holds in every phase

These rules come from the prototype's "Principles and map" note, at line 1257:

- **Three levels, like the desktop.** Home lists tasks. A task shows its panes as tabs, as the
  desktop's pane switcher does. A conversation opens inside its task. Back goes up one level.
- **The desktop's parts.** Every dropdown is the kit's filterable `Picker`. Tabs, rows, cards,
  switches, menus, and transcript cards come from `packages/client-core/src/kit/components/`. The
  text glyphs ‹ ▾ ↗ › become Lucide icons through the kit's `Icon`.
- **Say it once.** No sentence explains what a button already says. A state is an icon and at most one
  word.
- **Fewer steps.** Answer an agent from any screen in two clicks. Turn an issue into a task and a
  chat in three.
- **Stable navigation.** The bottom bar goes. Tabs live under a task.

Three traps catch extension work in this repository:

- The sidebar doesn't load the client's `base.css` or `shell.css`. A kit class that only those
  sheets style renders unstyled in the sidebar. Check each kit part you adopt in the built sidebar,
  and add its rules to `apps/extension/src/sidebar/sidebar.css` when they're missing.
- `apps/extension/vite.config.ts` loads `@acorn/protocol` source in plain Node. Run
  `pnpm --filter @acorn/extension build` after you change what the extension imports from the
  protocol package. Tests and `tsc` don't run that path.
- `pnpm dev:extension:ui` drives the sidebar by button text and form field names. Its `fill` verb
  picks a native select's option. As selects become kit pickers, add a verb that opens a picker and
  picks a row, so the real-browser checks in each phase can still run.

A phase that adds a bridge operation adds it in four places in the same change: the schema in
`packages/protocol/src/transport/extensionBridge.ts`, the handler in `apps/cli/src/browser/bridge.ts`,
a test in `apps/cli/src/browser/bridge.test.ts`, and the table in
[native messaging](../../browser-extension/native-messaging.md).

When a phase ships, update the reference page it changes under `docs/browser-extension/`, and the
status line at the top of the phase file.

## The phases

| Phase | What changes | Prototype scenarios |
| --- | --- | --- |
| [1](./01-navigation.md) | Home, task, and conversation levels, a top bar that names the task, tabs under a task, and the panel following the browser tab | Principles and map, Moving between pages, Node offline |
| [2](./02-go-to-task-and-menus.md) | **Go to task** with ⌘K, and the task and conversation ⋯ menus | Go to task |
| [3](./03-home.md) | Home's task list: workspace picker, filter, project groups, and agent markers | Home |
| [4](./04-needs-you.md) | The **Needs you** button on every screen, compact rows answered in place, and the desktop's request card | Answer an agent |
| [5](./05-this-page.md) | The issue card, running a workflow on an issue, and the project site card | An issue with no task, Run a workflow on it, A project site |
| [6](./06-agents-tab.md) | The Agents tab: grouped stacked rows, **New chat** in the header, and folds | Agents, New chat |
| [7](./07-conversation.md) | The conversation: folded tool calls, the composer's state line, **Stop**, and the desktop's keys | Conversation |
| [8](./08-runs-tab.md) | The Runs tab: steps under their run, and **Run workflow** in a task | Runs |
| [9](./09-plugin-panels.md) | The pull request and Docker panels, drawn with more care from the same blocks | Pull request panel, Docker panel |
| [10](./10-settings.md) | One Settings page: Nodes, Sites, Notifications, and Appearance | Settings, Add a site |
| [11](./11-connect.md) | Installing the bridge, pairing, and the paired screen | Bridge not installed, Pair with this Mac, Pair with another Node, Paired |
| [12](./12-on-the-page.md) | The task chip, the start chip, the branch marker, and the ask box | Task chip, Start task chip, Branch marker, Ask about an element |
| [13](./13-context-picker.md) | Optional: a **Context** picker in the composer. Needs a decision first | Add page context |

## Order and dependencies

Phase 1 comes first. Every later phase draws inside the three levels it builds, and most of the
sidebar's state moves in that phase.

Phases 2 to 9 each need phase 1 and are otherwise independent. Phase 4's top-bar button is easier
after phase 2, because both add controls to the same top bar. Phase 6's empty state shows the item
chip that phase 5 leaves waiting, so take phase 5 before phase 6 if you can.

Phase 10 is independent of phase 1, apart from where Settings opens from. Phase 11 needs the Node
rename from phase 10, because it drops the name field from pairing. Phase 12 needs phase 5 for the
start chip, and phase 1 for **Show in side panel** opening a task.

Phase 13 waits on a decision, recorded in its file.

## Out of scope

The desktop and terminal clients don't change in this plan. A review on October 16, 2026 found three
ideas from the prototype worth taking to them later: answering a permission from the desktop bell's
**Needs you** list, folding a run of tool calls into one line in the agents plugin's transcript, and
a pairing approval prompt in the terminal client. Each needs its own plan.
