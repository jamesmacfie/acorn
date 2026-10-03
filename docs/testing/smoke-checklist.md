# The smoke checklist

Run this pass against the packaged desktop app on a clean host before an alpha release. The
development window and the headless suites don't exercise native chrome, packaged schemes, or
host-owned child webviews, so this pass is the only check of those. Record the artifact version,
operating system, result, and any issue for each step.

## Before you start

Run these on the release commit:

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/desktop test
pnpm db:check
```

`pnpm test:coverage` is a diagnostic for four contract paths and has no release threshold.
[Measure coverage](./commands.md#measure-coverage) describes its scope.

## The release pass

1. Install the signed artifact on a clean host. Launch it, finish onboarding, open a local project,
   create a task, and confirm that the local Node reaches online. Quit and relaunch. The task and
   pairing are still there.
2. Pair a second Node by code. Confirm the fingerprint words, switch between Nodes, and open a task on
   each. Disconnect and reconnect the second Node. The first Node's task data stays scoped to it.
3. Start a managed agent with an installed CLI, approve or deny one tool request, and reopen its
   transcript after a restart. Open a terminal session, send a command, and confirm that it survives a
   task switch.
4. Open a task preview through the tunnel and a host-owned editor. Navigate the preview, open an
   overlay, and confirm that the child webview stays behind it. Check the native menu and one file
   dialog.
5. Install a freshly scaffolded plugin from a local package. Accept the bundle, open its pane, run its
   command, and confirm that its Node route result appears. Reload after you edit its entry and route
   module, then disable, enable, and remove it. Confirm that its UI and command follow each step, and
   that an unaccepted bundle can't draw.
6. Open the terminal client at 80 by 24 and at 120 by 40. Use the keyboard to move through the rail,
   pane strip, a plugin pane, the palette, and a PTY. Confirm that Escape restores focus and that the
   trust prompt holds focus until you decide.
7. Create and run a workflow with a gate, inspect its child task and history, and resume or cancel it.
   If release accounts are set up, run a query-backed schedule against a real provider and confirm
   that a repeated check creates no duplicate child.
8. Quit with an active agent and confirm the concern prompt and a clean shutdown. Stop the helper's
   Node repeatedly. The recovery screen appears after the retry limit.

## Feature checks

The release pass doesn't cover every surface. After a change to one of these areas, run its checks
too. Each page keeps its original check numbers, which are separate from the release pass steps above.

| Checks | Page |
| --- | --- |
| 1–26, 86–88 | [Desktop and plugins](./desktop-and-plugins.md) |
| 27–42 | [Terminal and palette](./terminal-and-palette.md) |
| 43–47, 79–85 | [Changes and large surfaces](./changes-and-large-surfaces.md) |
| 48–57, 65–69, 73–78 | [Workflows](./workflows.md) |
| 58–64, 70–72 | [Agents and providers](./agents-and-providers.md) |
| 89–99, 145–148 | [Rail and annotations](./rail-and-annotations.md) |
| 100–144 | [Settings, custom agents, and MCP servers](./settings.md) |
| 149–154 | [Computer Use approval](./computer-use.md) |
| Unnumbered | [Memory](./memory.md) |
| A1–A16 | [Native overlays](./native-overlays.md) |

[The manual check catalog](./manual-checks.md) indexes the same pages. A worktree run can use
`pnpm dev:agent` for isolated data and ports. A normal development run from a worktree may need the
main checkout's `.env`, and another development instance may already hold the renderer's port, 4319.
Packaged-shell and native checks still need the release artifact on a graphical host.

## Known gaps

One appearance bug is recorded here so that fixing it is a deliberate decision. Under
`prefers-color-scheme: dark`, the `:root:not([data-theme="light"])` block in
`packages/client-core/src/infra/styles/tokens-theme.css` has the same specificity as a named theme
block and sets `--is-dark: 1`. The `solarized-light` and `catppuccin-latte` blocks don't reset it. With
the OS in dark mode, those two light themes tell xterm and CodeMirror they're dark while they render
light. The fix is two lines, but it changes what users of those two themes see, so it belongs in its
own change with its own release note.
