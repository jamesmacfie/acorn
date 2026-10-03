# First-party plugins in the terminal

This page lists what each first-party plugin loses when the terminal client draws it. It's part of
[first-party plugins](../first-party-plugins.md). What each extension kind and host slot does in the
terminal is in [what a plugin loses in the terminal](../tui/plugin-losses.md).

## What each of these loses in a terminal

The terminal client draws the same panes from the same source ([the terminal client](../tui.md)). A
plugin writes no terminal UI, so this isn't a second implementation. It's what the kit's `reduced` and
`absent` levels come to when a pane is read at 80 by 24. Only the plugins that lose something are
listed.

| Plugin | What a reader loses |
| --- | --- |
| **editor** | CodeMirror. The `editor` rectangle draws a box and says the file opens there. The reader's own `$EDITOR` runs in the box instead, on one device preference. The file tree, search, and tabs are unchanged |
| **terminal** | The drawer, which is a place between two icon rails on the desktop. A PTY still draws in cells wherever a pane mounts one |
| **docker** | Nothing of the pane. It's offered only on a task with containers, as on the desktop, and `exec` is a native PTY |
| **preview** | The pane. It asks for the `preview` seam, the terminal installs none, so it's absent from the strip |
| **agents** | Attaching a file and saving one out. **Attach**, both **Export** rows, and an artifact's download use the platform seam's `pickFiles` and `saveFile`, which answer empty where the host installs no `files` group (`client-core/infra/platform/index.ts`). Also **Continue in terminal**, which hands the session to a drawer this host doesn't draw, and the three settings pages. Running an agent works: opening a session, answering what it's blocked on, and sending turns ([terminal client tests](../tui/tests.md)) |
| **github** | Nothing of the five surfaces. There's no URL, so a content link resolves to a pane or a reference panel and stops there |
| **workflows** | The rail source, editor, and run pane cross whole. An agent node is the agents plugin's own conversation, so it works as far as that plugin does here |

What another plugin brings into these panes crosses too: GitHub's diff-line marks and the badges beside
a pull request's state draw in cells. What stays absent is the host UI slots, the terminal drawer and
the two `overlay` entries GitHub and agents use for router- and query-scoped commands. The editor's ⌘P
file palette is a command on the shared palette session, so it draws here.

Nothing is missing from changes, context, memory, notes, or onboarding. The loaded plugins with a UI,
such as http, linear, rollbar, and database, reach the terminal through the worker sandbox and draw the
same nodes into cells.
