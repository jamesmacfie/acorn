# Phase 2 — Settings, persistence, and lifecycle

**Size: M.** Requires [phase 1](./phase-1-bindings.md). Plugin bindings become visible and
changeable in Settings → Shortcuts, and the override store survives plugins being disabled,
updated and uninstalled.

## What exists

`packages/client-core/src/settings/ShortcutsSettings.tsx`, 88 lines, already does the hard parts:

- lists resolved bindings, grouped by `category`,
- captures a new chord and saves it into the `keybindings` pref via `saveJsonPref`,
- refuses a save that would collide, using `keybindingConflict`, with the message
  "`⌘K` is already used by …",
- per-binding **Reset** (back to `defaultChord`) and a global **Reset all to defaults**
  (writes `{}`),
- renders `binding.conflict` inline with a `shortcut-conflict` class.

Because phase 1 registers plugin bindings as ordinary `KeybindingContribution`s with
`category: pluginName`, they appear in this UI **with no changes at all**. That is the point of
having done it that way, and it means this phase is about the edges rather than the feature.

## The edges

### 1. Orphaned overrides

The override map is `{ [bindingId]: chord | null }` keyed by binding id, persisted in the node's
`prefs` table. Three ways a key stops matching anything:

- the plugin is **disabled** — bindings still registered, `active` false;
- the plugin is **uninstalled** — bindings gone entirely;
- the plugin **updated and renamed a command**, so `plugin.x.old-id` no longer exists.

Rules:

- **Never garbage-collect on read.** An uninstalled plugin's overrides stay. Reinstalling and
  finding your rebind intact is the behaviour people expect, and the map is a few dozen bytes.
- **Never surface an orphan as a broken row.** A binding id with no contribution is not rendered.
  It is data waiting for its plugin.
- **Offer one explicit cleanup**, not automatic: a "Remove settings for plugins that are no longer
  installed (N)" line at the bottom of Shortcuts, next to Reset all. Only ever user-initiated.
- **A renamed command id loses the override, silently.** There is no way to detect the difference
  between a rename and a removal. Push this into authoring guidance instead: binding ids must be
  stable across versions, because they are the key a user's override is stored under. Worth a
  sentence in the plugin docs and a line in whatever authoring guide exists later.

### 2. Disabled plugins in the list

A disabled plugin's bindings are registered but inert (`active` false). Two options, and the
second is right:

- Hide them — the list matches what works, but a user who rebound something and then toggled the
  plugin sees their setting vanish.
- **Show them, visibly inactive** — greyed row, "plugin disabled" note, still editable. Editing a
  disabled plugin's chord is a legitimate thing to do before re-enabling it.

Do not let a disabled plugin's chord participate in conflict detection *for dispatch* (phase 1's
`active` already handles that), but **do** count it for the save-time conflict warning: silently
allowing a chord that will collide the moment the plugin is re-enabled just moves the surprise.
That is a change to `keybindingConflict`, which currently ignores `active`.

### 3. Node scope

`PrefKeys.keybindings` lives in the node's `prefs` table, so overrides are **per node, per user**
— not per device. Consequences to face rather than paper over:

- Two nodes can disagree about the same plugin's chord. The dispatcher resolves against the
  **active node's** prefs, so switching nodes can change what a key does.
- A plugin installed on node A but not node B has bindings only on A. Its rows should not appear
  in Shortcuts while B is active — phase 1's `active` predicate already keys on
  `pluginEnabledOnActiveNode`.

v1 answer: **leave it per-node and make it legible.** The Shortcuts page already sits in a
node-scoped settings modal; add the node name to the section header for plugin groups so "why is
this different here" has an answer on screen. A device-scoped or synced override store is a
bigger decision (it collides with the fleet model, where nodes are independent peers) and needs a
real reason before it is worth having.

### 4. Reset all

`Reset all to defaults` writes `{}` — which today clears core overrides and, after phase 1, plugin
ones too. That is probably right, but it is now a bigger hammer than the button's label suggests.
Either scope the button per group ("Reset all in this section") or keep one button and name what
it does in the confirmation. Prefer per-group: the person resetting a plugin's chords rarely wants
to lose their core rebinds too.

## The unbind affordance

`readKeybindingOverrides` already treats `null` as "explicitly unbound", distinct from absent. The
UI has Reset (restore default) but no explicit **Unbind**. With plugin bindings arriving, unbind
becomes worth having: the natural response to "this plugin took a chord I want free" is to remove
it, not to reassign it somewhere arbitrary.

Small addition — an ✕ next to each row writing `null` — and the resolver already handles it.

## Steps

1. Confirm plugin bindings render correctly in the existing UI before writing anything: group
   headers, conflict rows, reset. Most of this phase may be smaller than it looks, and finding that
   out first tells you where the real work is.
2. Disabled-plugin rows: greyed, labelled, still editable; `keybindingConflict` counts inactive
   bindings.
3. Unbind (✕) per row.
4. Orphan handling: hide unmatched ids, add the explicit cleanup line with a count.
5. Per-group reset.
6. Node-name context on plugin groups.
7. Docs: `docs/command-palette-and-shortcuts.md` gains a "Plugin shortcuts" section covering
   precedence, per-node scope, and what happens when a plugin is removed.

## Tests

- Rendering: a plugin binding appears under its plugin's group; a disabled plugin's binding renders
  inactive; an orphaned override renders nothing.
- Save-time conflict includes inactive bindings and reports the owning plugin by name.
- Unbind writes `null` and the chord stops dispatching; Reset restores `defaultChord`.
- Cleanup removes only ids with no contribution, and only when invoked.
- Round-trip: override → disable plugin → enable → override intact. Override → uninstall →
  reinstall → override intact.
- Per-group reset does not touch other groups.

## Exit criteria

- Every plugin binding is visible, rebindable, unbindable and resettable in Settings → Shortcuts.
- Disabling or uninstalling a plugin never destroys a user's override or leaves a broken row.
- A chord that will collide on re-enable is warned about at save time, not discovered later.
