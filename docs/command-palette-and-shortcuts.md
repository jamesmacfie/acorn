# Command palette and shortcuts

Keyboard commands are registered by the shell and feature contributions. `CommandPalette.tsx`
combines static actions, plugin palette rows, task/workspace rows, and Node-aware aggregate results.
It imports no feature implementation.

## Global commands

| Shortcut | Action |
| --- | --- |
| `⌘K` | Open command palette |
| `⌘P` | Open worktree file finder |
| `⌘L` | Open workspace switcher |
| `⌘⇧N` | Create a local task |
| `⌘⇧T` | Toggle terminal drawer |
| `⌘1`–`⌘9` | Activate the corresponding visible task |
| `⌘,` | Open Settings |
| `Escape` | Close the topmost overlay or cancel the current action |

The exact platform modifier is handled by the keyboard layer. Inputs, editors, terminals, and
contenteditable elements stop global commands unless a command explicitly opts into text handling.

## Palette data

Palette rows can be static or task/Node-backed. Fleet rows carry a Node label and tolerate partial
availability. A row action targets the Node that owns its resource; no aggregate action pretends to
be cross-Node atomic.

Run targets and workflow rows are contributed from the Node's task configuration. Pane and source
commands are registered by their owning plugin. A loaded plugin's manifest `commands` descriptors are
promoted into the same command registry: one command supplies both its optional palette row and any
keybinding target. The legacy manifest `palette` array is a compatibility alias for a command with
`palette: true`; it never produces a second row.

User-configured shortcuts outrank defaults. Among defaults, first-party bindings win, then loaded
plugins in lockfile installation order with plugin id as the stable tiebreak. A losing binding is
unbound and named as a conflict; no fallback chord is invented.

## Pane shortcuts

The shipped pane chords are contribution-owned and tested with the pane registry. Settings →
Shortcuts can override or unbind them. Persisted pane IDs remain stable because they are layout data.

## Plugin shortcuts

Loaded plugins declare canonical `meta+ctrl+alt+shift+key` chords against commands from their own
manifest. The host qualifies both ids as `plugin.<plugin-id>.<command-id>`, refuses bare keys and
does not expose `typing-exempt`. A `surface` binding is host-bound to a surface declared by that same
manifest.

Settings → Shortcuts shows plugin bindings under the plugin id and names the active Node because
shortcut preferences are per Node, per user. Disabled-plugin rows remain visible, inert and editable;
plugins absent from the active Node do not appear. Uninstalling never deletes overrides, so reinstalling
restores them. The explicit orphan-cleanup action is the only path that removes settings for plugins
which are no longer installed. Reset operates per section and Unbind persists an explicit `null`.

Binding ids are persistence keys. Plugin authors must keep command ids stable across versions or a
renamed command will no longer find the user's override.

## Focus and typing

The global key handler checks editable targets, terminal focus, composition state, modifier intent,
and open overlays. The terminal drawer and main task surface have separate focus restoration so a
palette close returns focus to the action that opened it.

A sandboxed plugin frame has its own document, so its SDK normalizes and forwards unclaimed keydowns
over the existing rate-limited bridge. The host resolves them against the same binding table, preferring
that frame's surface binding before global or task bindings. This keeps shell chords working while a
frame is focused without adding another shell listener.

A frame may keep only the modified chords declared in its manifest `claimsKeys`. Runtime
`acorn.keys.claim()` may narrow that set, never extend it. Claims are visible in Shortcuts and in the
trust prompt. The palette (`meta+k`), settings (`meta+,`), task switching (`meta+1`–`meta+9`) and
`escape` are reserved and cannot be claimed. Bare typing inside a frame remains local.
