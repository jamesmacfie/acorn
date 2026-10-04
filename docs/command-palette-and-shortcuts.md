# Command palette and shortcuts

The shell and feature plugins register keyboard commands, and one palette session and one keymap
engine serve both the desktop and the terminal client. Read this page for the global shortcuts and to
find the page that owns the palette, its data, shortcut resolution, or focus.

## Global commands

These are the default desktop chords. Settings → Keyboard shortcuts can rebind or unbind each one.

| Shortcut | Action |
| --- | --- |
| `⌘K` | Open the command palette |
| `⌘P` | Go to a file in the worktree (the palette, at the editor's file search) |
| `⌘⇧F` | Find in files (the editor pane, with its search panel focused) |
| `⌘L` | Open the workspace switcher, most recently visited first |
| `⌘;` | Switch to the last workspace |
| `⌘⇧N` | Create a local task |
| `⌘⇧T` | Toggle the terminal drawer |
| `⌘B` | Toggle the rail |
| `⌘⇧Enter` | Maximize or restore the focused pane |
| `⌘1` to `⌘9` | Activate the matching visible task |
| `⌘,` | Open Settings on the last page used |
| `⌘/` | Open the cheat sheet of keys that work here |
| `Shift+F10` or the menu key | Open the context menu for the focused row. The platform fires `contextmenu`, and the shell doesn't bind it. |
| `Enter` on a dashboard row | Open its configured destination. Its menu carries the row buttons and Start task. |
| `Escape` | Close the topmost overlay or cancel the current action |

The keyboard layer picks the platform modifier: Cmd on macOS, Ctrl elsewhere, and Ctrl in the
terminal client. Inputs, editors, terminals, and `contenteditable` elements stop global commands
unless a command opts into text handling. [Focus and typing](./command-palette-and-shortcuts/focus-and-typing.md)
owns that rule.

The desktop also has a fixed Cmd+K or Ctrl+K accelerator in the application menu. A preview is a
separate native webview whose key events can't reach the renderer, so the menu forwards that
accelerator to the palette's toggle command. Other global shortcuts belong to the renderer, and
rebinding the palette in Settings doesn't change this native fallback.

## Pages

<a id="the-palette-session"></a>

[The palette session](./command-palette-and-shortcuts/palette.md) covers the one session both hosts
draw: groups, search, input, and setting commands, scopes, outcomes, and when the session closes.

<a id="core-and-plugin-commands"></a>

[Palette commands](./command-palette-and-shortcuts/commands.md) covers core's command tree, hidden
source openers, the last-workspace toggle, what each plugin contributes, and why every row is a
command.

<a id="palette-data"></a>
<a id="what-the-palette-refuses"></a>

[Palette data](./command-palette-and-shortcuts/palette-data.md) covers palette rows, manifest
command kinds, the `navigate` and `surfaceAction` verbs, context-menu rows, and the decisions the
palette refuses.

<a id="pane-shortcuts"></a>
<a id="plugin-shortcuts"></a>

[Shortcuts](./command-palette-and-shortcuts/shortcuts.md) covers pane chords, plugin chords,
precedence and conflicts, and the keys a sandboxed frame can claim.

<a id="focus-and-typing"></a>

[Focus and typing](./command-palette-and-shortcuts/focus-and-typing.md) covers the one keymap
engine, intents, typing targets, focus regions, collections, scopes as layers, the terminal's
overlays and rectangles, and the cheat sheet.
