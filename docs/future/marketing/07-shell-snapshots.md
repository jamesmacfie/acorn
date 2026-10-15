# Phase 7: capture whole windows from a real app

Date: October 15, 2026. Status: proposed. Needs phase 3. Phases 8 and 9 depend on it.

## Goal

The landing page and feature pages show whole acorn windows, desktop and terminal, in realistic states:
a task with an agent mid-turn, a diff, a pull request review, a workflow run. Each picture is HTML and
CSS captured from a running app on fixture data, so it's sharp at any size, restyles with the site's
theme picker, and never shows anyone's real work.

## Starting point

- `pnpm dev:agent -- --session <name>` starts an isolated desktop app with its own data and ports, and
  `pnpm dev:agent:ui` drives it: `snapshot`, `click`, `fill`, and `screenshot`. A WebDriver session can
  run a script in the window and read the DOM. [Agent drivers](../../local-development/agent-drivers.md)
  covers both.
- The agent-launched window is hidden, never on screen. Animations and `requestAnimationFrame` don't run
  in it, so capture settled states only.
- `apps/tui/src/fixture.ts` and `renderFixture` in `apps/tui/src/harness.tsx` draw the whole terminal
  client against fixture data with no TTY, which is how `pnpm --filter @acorn/tui capture` prints a
  frame.
- Managed agent sessions can be seeded into a data folder without a live agent turn, so a transcript
  can show a finished tool call and a diff summary with no model call.
- Phase 3 produced the scoped kit stylesheet and the terminal cell format.

## Scenes

Capture these, each at 1440 by 900 for the desktop and 120 by 36 for the terminal unless noted:

| Scene | Used on |
| --- | --- |
| A task with the agent pane mid-conversation, the Changes pane with a diff, and the terminal drawer open. The left rail shows sources and three tasks with status marks. | The landing hero, desktop |
| The same task in the terminal client. | The landing hero, terminal |
| A pull request review with an inline thread and checks. | `/features/review/` |
| A workflow run on its graph, one step waiting at a gate. | `/features/automation/` |
| The Database pane with a schema, a query, and its result. | `/features/task-tools/` |
| The command palette open over a task. | The landing tour |
| Settings, on a plugin's Permissions tab. | `/features/plugins/`, `/features/security/` |
| Fleet home with two Nodes. | `/features/nodes/` |
| The browser extension sidebar beside a pull request page. | `/features/browser/` |
| The terminal client at 80 by 24. | `/features/desktop-and-terminal/` |

## Steps

### 1. Write the fixture

Make one fictional world and use it everywhere, so pictures on different pages agree with each other:
one workspace, two projects, a handful of tasks, a pull request with a review thread, a seeded Claude
Code session, a workflow definition with a finished run, a Postgres schema, and notes. Keep it in
`apps/site/snapshots/fixture/` (new folder), with a small Git repository for the project, so worktrees
and diffs are real.

Use invented names throughout: people, organizations, repository names, and URLs on `example.com`.

### 2. Capture the desktop

Write `apps/site/scripts/capture-shell.mjs` (new). For each scene it:

1. Seeds a fresh `dev:agent` session's data folder from the fixture.
2. Starts the session and drives it to the scene with the UI driver.
3. Runs a script in the window that clones the shell's DOM, then removes scripts, event handler
   attributes, and child webviews. It replaces each webview with a labeled placeholder, and replaces
   each xterm element with a `<pre>` of the terminal's buffer lines, because xterm draws text the clone
   can't carry.
4. Writes `apps/site/src/generated/snapshots/<scene>.html` (new) with a header comment holding the commit
   and the capture date.

The site draws a snapshot inside a `div.acorn-ui` with phase 3's scoped stylesheet, so it follows the
visitor's theme.

### 3. Capture the terminal

Extend `apps/tui/src/capture.tsx` to write the phase 3 cell format instead of plain text, for each
terminal scene, into `apps/site/src/generated/snapshots/<scene>.cells.json` (new). Use the same fixture.

### 4. Keep real data out

Add a test that scans every committed snapshot and fails on:

- An absolute home folder path, such as `/Users/` or `/home/`.
- An email address outside `example.com`.
- Anything shaped like a token: a GitHub token prefix, a long hex or base64 run, or a bearer header.
- A hostname outside `example.com`, `localhost`, `github.com`, and `acorn.sh`.

A snapshot that fails this test is never committed with an exception. Fix the fixture instead.

### 5. Optional: make the hero clickable

Skipped. James decided on October 15, 2026 to keep one hero scene. Don't build this step.

herdr's hero is "a real layout" you can click. acorn can do the same thing cheaply: capture two or three
variants of the hero scene, one per task in the rail, and swap between them when the visitor clicks a
task. That's a few lines of script and no live app. [Phase 8](./08-landing.md) decides whether it's worth
the extra weight.

### 6. Document recapture

Add a section to `docs/site.md` (new) with the command that recaptures one scene or all of them, how long
it takes, and when to run it: after a change to the shell, the panes in a scene, or the stylesheets.
Phase 4's report lists snapshots older than their sources.

## Out of scope

Animation and video. A recorded sequence of terminal frames, the way opentui does it, could come later
for the terminal client, and it's not needed to launch.

## Acceptance

- Every scene in the table is captured, committed, and shown at `/lab/snapshots/` in Light and Dark.
- The privacy test passes, and fails on a planted home path.
- Recapturing all scenes takes under 15 minutes on a developer machine, and the steps are in the site's
  internal page.
- A snapshot on a page passes the budget. Record each snapshot's compressed size there too.

## Risks

- The desktop window lazily renders long lists, so a clone holds only what was in view. Size each scene
  so what matters is in view.
- A hidden window may skip work that only runs when visible. If a scene draws differently hidden,
  record which and capture it from a visible window by hand.
- Snapshots go stale between recaptures. They're marketing pictures, not reference, so the staleness
  report is enough. A docs page that teaches a UI step should use a specimen, which can't go stale.
