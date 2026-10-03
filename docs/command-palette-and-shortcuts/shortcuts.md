# Shortcuts

This page covers how pane and plugin chords are declared, which binding wins a conflict, and the keys
a sandboxed frame can keep. It's part of
[command palette and shortcuts](../command-palette-and-shortcuts.md).

## Precedence and conflicts

User shortcuts outrank defaults. Among defaults, first-party bindings win, then loaded plugins in
lockfile install order, with the plugin ID breaking ties. The losing binding is unbound and named as
a conflict. No fallback chord is invented.

`resolveKeybindings` applies the overrides, the order, and the conflict rule before the engine sees
anything, and hands the engine one binding per chord. A losing binding arrives with a null chord and
registers nothing. That's why Settings can show it as a conflict while the keyboard acts as if it
weren't there.

Settings stores overrides by command ID in the device's `keybindings` preference. A `null` or empty
override unbinds a command, and resetting it restores the default.

## Pane shortcuts

Pane chords belong to the pane's contribution, and the pane registry tests cover them. Settings →
Keyboard shortcuts can override or unbind them. Pane IDs stay the same, because they're layout data.

A pane chord is a binding gated on the focused pane, not a layer of its own. A pane's layout can add
a layer: a `tabs` pane registers Cmd+1 through Cmd+9 as a `focus-within` layer on its own element.
In the terminal it's Ctrl+1 through Ctrl+9, because the emulator keeps Cmd. The layer shadows the
global task-switching chords while focus is in that pane and hands them back when focus leaves.

### A chord gated on a focused field

The changes pane's commit chord (`plugins/changes/src/client/commands.ts`) shows how to scope a chord
to a field without a key handler:

- The binding is `when: 'pane'` with `pane: 'changes'`, so it's live while the keys are in that pane.
  Its `active` check is the message field's own focus, because the pane is wider than its field, and
  Cmd+Enter in the diff's comment box belongs to that box. The field reports focus through the kit's
  `Textarea`, which both hosts support.
- The chord has a command modifier, so it reaches the binding while a text field has focus
  ([focus and typing](./focus-and-typing.md#focus-and-typing)).

The registration lives on the pane's model, not in a region, so the chord lives as long as the pane.
Below 80 columns, `list-detail` shows one side at a time, and a shortcut that disappeared when you
looked at the diff wouldn't be a shortcut ([pane models](../panes/models.md) § Pane models).

`meta+enter` commits, because it's the `commit` chord in the fixed intent set. Amend is
`meta+alt+enter`, because core uses `meta+shift+enter` for **Maximize or restore the focused pane**,
and two bindings on one chord leave the loser with nothing.

## Plugin shortcuts

Loaded plugins declare canonical `meta+ctrl+alt+shift+key` chords against commands in their own
manifest. The host qualifies both IDs as `plugin.<plugin-id>.<command-id>`, refuses bare keys, and
doesn't offer `typing-exempt` to plugins. A `surface` binding is tied to a surface the same manifest
declares.

Settings → Keyboard shortcuts lists plugin bindings under the plugin ID and names the active Node,
because shortcut preferences are per Node and per user. Rows for a disabled plugin stay visible,
inactive, and editable. Plugins missing from the active Node don't appear. Uninstalling never
deletes overrides, so reinstalling restores them. Only the explicit orphan cleanup action removes
settings for plugins that are no longer installed. **Reset** works per section, and **Unbind** saves
an explicit `null`.

Binding IDs are storage keys. Keep command IDs the same across versions, or a renamed command loses
the user's override.

## Keys in a sandboxed frame

A sandboxed plugin frame has its own document. Its SDK normalizes unclaimed key presses and forwards
them over the rate-limited bridge. The host resolves them against the same binding table, preferring
that frame's surface binding over global or task bindings. Shell chords keep working while a frame
has focus, without another shell listener.

A frame can keep only the modified chords its manifest declares in `claimsKeys`. At runtime,
`acorn.keys.claim()` can narrow that set but never widen it. Claims show in Settings → Keyboard
shortcuts and in the trust prompt. The palette (`meta+k`), Settings (`meta+,`), task switching
(`meta+1` to `meta+9`), and `escape` are reserved and can't be claimed. Bare typing inside a frame
stays in the frame.
