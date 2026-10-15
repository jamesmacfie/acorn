# Phase 11: write Start here and Using acorn

Date: October 15, 2026. Status: done. Needs phases 2 and 4. Picks up the design when phase 6 lands.

## Completion note

October 16, 2026. All 20 pages are written, published, and marked checked: the five Start here pages,
with "What is acorn" at `/docs/`, and the 15 Using acorn pages. The docs home's **Use acorn** card
links to every one of them. Every label on the pages was found in the code or seen in a `dev:agent`
session, and every behavior was checked against the page's sources and, where a doc was thin, the
component that draws it.

What landed:

- The pages, in `apps/site/src/content/docs/docs/start/` and `using/`, plus `index.mdx`. Pages that
  draw a picture or a key cap are `.mdx`.
- Two `Graph` diagrams for Concepts, in `apps/site/specimens/docs/`: `clients-and-node` and
  `task-parts`. Each has three cards in two ranks, placed with `positions`, because jsdom can't fit a
  graph and the docs column is about 760 pixels wide.
- The Appearance page embeds the site's own `Appearance` control, inline, above a picture that follows
  it.
- `starlight-links-validator` skips `/download/`, `/changelog/`, and `/features/**`, which it can't
  see. `docs/site.md` says so.

The acceptance checks: a production build and a preview build both pass the site's tests, 57 and 256.
`astro check` finds no errors. The quick start was walked end to end in a fresh `dev:agent` session on
a throwaway repository with a local remote: add, create, Claude Code session, diff, **Commit tracked**,
**Publish**, archive, and restore. In a fresh `dev:tui:agent` session it was walked from **New task**
to the diff in **Open Changes**. What that walk found is below.

### Decisions

- **Links go only to published pages.** A production build fails on a link to a draft, so these pages
  link to each other, to `/download/`, and to `/features/`, and not to the Agents, Settings, plugin,
  Nodes, or extension pages. Rule 9 is met within this phase's pages.
- **The window page's labeled picture is the hero scene and a table of regions**, each row saying where
  the region sits in the picture. Drawing labels over a captured window would need a new component and
  would drift with every recapture.
- **Keyboard shortcuts lists the defaults by hand**, copied from **Settings** > **Keyboard shortcuts**
  in the running app. Phase 14 generates the full reference, and the page cites the files that
  register the chords, so `stale` lists it when one changes.
- **The Build plugins card on the docs home links to `/features/plugins/`**, because every plugin docs
  page is a draft.

### Deviations

- **The internal docs say a pane no plugin provides draws as a placeholder.** `TaskPaneHost.tsx` leaves
  it out of the drawn row and keeps its ID in the saved row. The Panes page describes the code.
  `docs/features.md` and `docs/panes/layout.md` need the same correction from their owner.
- **The terminal client can't archive, restore, or delete a task, and nor can the command line.** No
  source doc says this plainly. The quick start, Archive and restore, and Desktop and terminal say so.
- **The desktop archive passes `force: true`**, so archiving discards uncommitted changes and stops
  running sessions. The Git plugin's archive check warns first. Archive and restore says so.
- **Three themes are light and nine are dark**, read from `--is-dark` in `tokens-theme.css`.

### What the terminal quick start found

These are behaviors in the terminal client, not page errors. The pages steer around them, and each
deserves a look from whoever owns `apps/tui`:

- Tab cycles through the **Menu** panel, which opens its first source, Docker, and leaves the task.
  That made it impossible to reach the Changes tab's commit box from the keyboard.
- **Go to task** sometimes answers **No results** for the open task, even with an empty query.
- Enter on a row in **Tasks** previewed **Task to open** but didn't open it. **Start working** after
  **New task** went back to Docker instead of the task.
- `pnpm dev:tui:agent -- --reuse --link acorn://local/t/<id>` started on Docker, not the task.
- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> didn't switch to the Git pane in the agent driver's PTY.

### What later phases need to know

- Add links from these pages as later pages publish: the quick start and Concepts to Agent sessions,
  Harnesses and defaults, and Nodes; Install to Set up the extension, Pair a device or a remote Node,
  and Run a standalone Node; Tasks and worktrees to the GitHub, Linear, and Rollbar plugin pages;
  Keyboard shortcuts to the keyboard reference; Notes and Task context to the Context plugin page;
  Project configuration to the Configuration files reference.
- The landing, feature, and download pages' link test still needs its preview-only skip, because most
  pages they link to are still drafts.
- Phase 14's keyboard reference should replace the tables on Keyboard shortcuts with a link.
- A docs page that links to a marketing route other than the three above needs that route added to the
  validator's `exclude` in `astro.config.mjs`.
- The architecture checks fail on this base as earlier phases recorded, with nothing from this change.
- Nothing here needs a deploy, so nothing is left for phase 20.

## Goal

A developer installs acorn, opens a project, starts a task, runs an agent in it, and finds their way
around the window, using only the docs. Every core feature has a page that says what it does and how to
use it, written for someone using acorn, not someone maintaining it.

This phase also sets the rules every docs page follows. Phases 12, 13, and 14 point back here.

## How every docs page is written

These rules apply to every page in phases 11 to 18:

1. **Start from the sources, then check the app.** Read every file in the page's `sources`. Then do
   what the page describes in a `dev:agent` or `dev:tui:agent` session, because internal docs describe
   contracts and rarely the clicks. A step nobody performed doesn't go on the page.
2. **Open with what and who.** One or two sentences: what the page covers and who needs it.
3. **Task headings start with a verb**: "Start an agent session". Concept headings are noun phrases.
4. **Number procedures**, one action per step, with what the reader should see after a step that
   changes the screen.
5. **Name UI labels exactly as the app draws them**, in bold, and the path to them: **Settings** >
   **Agents** > **Harnesses and defaults**.
6. **Show, don't describe, where a picture helps.** Use a specimen for a component or a pane region and
   a snapshot for a whole window. Don't add a picture that shows nothing the text doesn't.
7. **Every page that behaves differently in the terminal client has an "In the terminal" section**,
   with the same heading everywhere, so readers learn to look for it.
8. **End with limits.** What it doesn't do, stated plainly, from the source doc's limits.
9. **Link, don't repeat.** If another page owns a detail, link to it.
10. **Clear the page in phase 4's report** with `--mark` once it matches its sources, then remove
    `draft`.

[Voice](./voice.md) applies to every word.

## Start here

| Page | What it must cover |
| --- | --- |
| What is acorn | The one-line description and paragraph from phase 1. The model in one picture: workspace, project, task, panes. The four clients. Where to go next for using it, and for extending it. |
| Install | Every route from `/download/`, in more depth: requirements, the first launch, the first-run wizard and what each step does, including **Layout** and **Generate with AI**, and how to tell it worked. Pairing the browser extension links to phase 14's page. |
| Quick start | A tutorial with a checkpoint after each step: add a project, create a task, start a Claude Code or Codex session, ask for a small change, read the diff in Changes, commit and push, and archive the task. Each checkpoint says what the reader should see. |
| Concepts | Node, client, and device. Workspace, project, and task. Panes and the rails. Plugins, in one paragraph. What lives on the Node and what lives on your device. A diagram drawn with the kit's `Graph` as a specimen, not an image. |
| Desktop and terminal | What's the same and what differs: one pane at a time, the overlays, the footer's key hints, and what a terminal can't draw. A plugin pane as a specimen on both hosts. Starting the terminal client against a running Node. |

## Using acorn

| Page | What it must cover |
| --- | --- |
| Workspaces and projects | Turning workspaces on and off, adding a project, hiding and coloring projects, workspace icons, and the project settings tabs. |
| Tasks and worktrees | Creating a task from the palette, GitHub, Linear, or Rollbar. When the worktree is created and where. Switching tasks. Reaching a task by link. Cleaning up worktrees. |
| Task scripts | What setup and teardown scripts are, where they're configured, how to read their output, and what happens when one fails. |
| Archive and restore | What archiving cleans up, the checks a plugin can run first, searching the archive, the read-only preview, and restoring onto the branch. |
| Panes | The row: show, add, close, pin, move, resize, maximize, and equalize. Saved per task and Node. A pane no plugin provides any more. |
| The window: top bar, rails, and drawer | The top bar's pickers and status. The left rail's sources and **Show in left rail**. The optional workspace rail. The right rail's pane switcher. The terminal drawer. Each region drawn as a labeled snapshot. |
| The command palette | Opening it, searching, the five kinds of command, nested groups, inputs and settings inside the palette, and scope across Nodes. |
| Keyboard shortcuts | The default chords, generated from the keymap ([phase 14](./14-docs-nodes-extension-automation.md#reference-pages)), changing one, conflicts and who wins, and focus rules: what Escape does where. |
| Notifications and the inbox | The agent states worth interrupting for, the four channels, the inbox, acknowledging, and the settings. |
| Notes | Task, workspace, and global notes, and sending a note to an agent. |
| Memory | What agents write, the memory contract, the Memory page, history and Undo, and importing Claude memory files. |
| Task context | Choosing, previewing, sizing, and sending context to a session. |
| Appearance | The 12 themes and 4 style packs, picked separately, shown with the site's own picker. Plugin themes and packs, and what happens when their plugin is off. |
| Links into acorn | `acorn://` links, **Copy link**, and opening one in the desktop app or the terminal client. |
| Project configuration | `.acorn/config.toml`: what it sets, why its values show as read-only in Settings, and trusting a changed file. |

## Out of scope

Agents in depth, security, and settings, which are [phase 12](./12-docs-agents-security-settings.md).
Built-in plugins, which are [phase 13](./13-docs-built-in-plugins.md).

## Acceptance

- Every page above is out of draft, with `sources` and a current `checked`.
- Following only the published pages, an agent completes the quick start in a fresh `dev:agent` session
  and in a fresh `dev:tui:agent` session. Record each step the pages got wrong or left out, and fix it.
  A person walking it on a machine that has never run acorn is [phase 20](./20-launch.md)'s job.
- Every UI path named on these pages exists in the current build. Check them in a `dev:agent` session.
- The docs home's **Use acorn** door links to every page here.
