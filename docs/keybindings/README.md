# Plugin keybindings

Letting a loaded plugin bind keys, without letting it steal keys that already work, and leaving
the user able to change any of it.

Written for the agent or developer implementing it: each phase has its own file with enough
context to finish it without re-deriving the analysis.

## Start here: most of this already exists

The keybinding system is more complete than "plugins can't bind keys" suggests. What is in the
tree today, all first-party:

| Piece | Where |
| --- | --- |
| `KeybindingContribution` — `{ id, command, description, category, defaultChord, when, pane, active? }` | `packages/client-core/src/registries/keybindings.tsx` |
| Scopes — `global`, `task`, `pane`, `typing-exempt` | same |
| `resolveKeybindings()` — applies user overrides, detects conflicts, unbinds the loser | same |
| `KeybindingDispatcher` — one capture-phase `keydown` on `window`, scope and typing-target checks, dispatches to a command | same |
| User overrides — a JSON map `{ [bindingId]: chord \| null }` in the `keybindings` pref | `readKeybindingOverrides`, `PrefKeys.keybindings` |
| Settings → Shortcuts — rebind, unbind, reset one, reset all, live conflict warning on save | `packages/client-core/src/settings/ShortcutsSettings.tsx` (88 lines) |
| `keybindingConflict()` — pre-save check so a rebind cannot silently steal | `registries/keybindings.tsx` |
| Chord format — `meta+ctrl+alt+shift+key`, normalised from the event | `tasks/paneShortcuts.ts` § `eventChord` |
| Commands — `{ id, title, category, palette?, requires?, when?, run }` and `executeCommand(id)` | `registries/commands.ts` |

So **user-settable keybindings with conflict handling already ship**. The three things missing are
all about the *plugin* half:

1. **A command a plugin can own.** `CommandContribution.run` is a closure. A loaded plugin cannot
   supply one, and a keybinding with no command to run is nothing. This is the real prerequisite.
2. **A declarative keybinding.** No manifest form, no precedence rule that protects existing
   bindings, no namespacing that stops a plugin claiming a core command id.
3. **The frame boundary.** A `keydown` inside an iframe does not bubble to the parent window, so
   shell chords are dead while a plugin frame has focus, and a frame's own chords never reach the
   dispatcher. Neither direction works today.

## Phases

| Phase | File | Size |
| --- | --- | --- |
| 0 — Plugin commands | [phase-0-commands.md](./phase-0-commands.md) | M |
| 1 — Declarative keybindings and precedence | [phase-1-bindings.md](./phase-1-bindings.md) | M |
| 2 — Settings, persistence, and lifecycle | [phase-2-settings-lifecycle.md](./phase-2-settings-lifecycle.md) | M |
| 3 — The frame boundary | [phase-3-frame-keys.md](./phase-3-frame-keys.md) | L |

Strictly ordered: 1 needs 0's commands to bind to, 2 needs 1's bindings to render, 3 needs all of
them to have something to forward. Phases 0–2 are useful without 3 for any plugin whose surfaces
are descriptors rather than frames; **phase 3 is what the editor move needs**
(`docs/third-party/editor.md`).

## The rules this project must not break

**Existing keybindings win, always.** A plugin binding never displaces a first-party one, and a
plugin installed later never displaces a plugin installed earlier. The loser is *unbound*, not
silently remapped, and the user is told. This is the rule that makes installing a plugin safe —
`resolveKeybindings` already implements "first wins, loser gets `chord: null` plus a `conflict`
label"; phase 1 only has to make the ordering deterministic and plugin-last.

**The user outranks everyone.** An explicit override in the `keybindings` pref beats defaults from
any source, including a first-party default. That is already true and must stay true: a user who
rebinds a core chord to a plugin command has made a decision, and the resolver must honour it
rather than "protecting" them.

**Namespaces are host-bound.** A plugin's command and binding ids are prefixed with its plugin id
by the host, from the manifest — never from a value in plugin code. Otherwise a plugin registers
`palette.open` and takes `⌘K`.

**No new global input paths.** Everything routes through the one capture-phase listener and the
existing command indirection. A plugin does not get its own `window` listener; that is the whole
reason the dispatcher exists.

**Typing safety is not negotiable.** The dispatcher's typing-target and terminal checks apply to
plugin bindings identically. A plugin must not be able to declare a bare `a` that fires while
someone is typing in a note.

## Cross-cutting decisions, made once

**Chords stay a string.** `meta+shift+k`, normalised by `eventChord`. No new grammar, no key
sequences (`⌘K ⌘S`), no per-platform variants. Chord strings are already persisted in user prefs,
so changing the format is a data migration for zero benefit.

**Overrides key on binding id.** Which means plugin binding ids must be stable across versions —
worth saying loudly in the authoring guidance, because a plugin that renames a binding id in an
update silently discards the user's override.

**Prefs are per-node, per-user.** `PrefKeys.keybindings` lives in the node's `prefs` table, so
overrides follow the node rather than the device. Phase 2 has to decide what that means when two
nodes disagree; do not paper over it.

**No `when` expression language.** VS Code has one; this does not need one. Scopes are the existing
four, plus a plugin-surface scope phase 1 adds. If a plugin needs finer conditions, the command's
own handler can decide to do nothing.

## Reference

- `packages/client-core/src/registries/keybindings.tsx` — read this first, all 133 lines.
- `packages/client-core/src/registries/commands.ts` — the indirection everything routes through.
- `packages/client-core/src/settings/ShortcutsSettings.tsx` — the UI phase 2 extends.
- `packages/node-core/src/main/pluginManifest.ts` — where descriptors are declared and validated.
- `packages/client-core/src/plugins/chrome/` — the descriptor host pass phases 0–1 join.
- `docs/command-palette-and-shortcuts.md` — the user-facing description; phase 2 updates it.
- `docs/plugins.md`, `docs/security.md` — the tiers and the trust model.
