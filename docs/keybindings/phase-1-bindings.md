# Phase 1 — Declarative keybindings and precedence

**Size: M.** Requires [phase 0](./phase-0-commands.md). After this phase a loaded plugin declares
chords in its manifest, they work, and they can never take a chord that already worked.

## The manifest

```jsonc
"contributions": {
  "keybindings": [{
    "command": "search",              // a command THIS manifest declares (phase 0), unqualified
    "defaultChord": "meta+shift+f",   // eventChord format; the host normalises and validates
    "when": "task",                   // 'global' | 'task' | 'surface'
    "surface": "editor"               // required when `when` is 'surface'
  }]
}
```

Validation at parse time, alongside the existing cross-field checks in `pluginManifest.ts`:

- `command` must be one this manifest's `commands` declares. A binding pointing at a command that
  does not exist is a manifest error, not a dead key.
- `defaultChord` parses under the same rules `eventChord` produces: lowercase modifiers in the
  fixed order `meta+ctrl+alt+shift+key`, one non-modifier key. Reject anything else — a chord the
  dispatcher can never match is worse than a rejected manifest, because it looks like it works.
- **A bare key with no modifier is refused.** `a`, `f`, `Enter` alone. Scope checks stop them
  firing while typing, but a plugin claiming an unmodified key is a footgun for every other
  surface and there is no use case that needs it. Require at least one of meta/ctrl/alt.
- `when` maps to the existing `KeybindingScope`: `global`, `task`, and a new `surface` that means
  "only while this plugin's named surface is focused" — the plugin-facing equivalent of the
  existing `pane` scope, which takes a pane id the host would otherwise have to trust.
- `typing-exempt` is **not** offered to plugins. It exists so a few core chords work inside text
  inputs; handing it out means a plugin can grab keys while someone is writing a note.

The binding id is host-derived: `plugin.<pluginId>.<commandId>`. One binding per command keeps the
override map simple and means the id is stable as long as the command id is.

## Precedence

The rule: **first-party defaults beat plugin defaults; earlier plugins beat later ones; the user
beats everyone.**

`resolveKeybindings` already does most of this — it walks the binding list in order, and a chord
already taken by an earlier binding leaves the later one with `chord: null` and a `conflict`
label naming the winner. What it does not do is guarantee the order. Today that is registry
insertion order, which is client plugin activation order, which is not a contract.

So phase 1 makes the order explicit before resolution:

```ts
const ordered = [
  ...bindings.filter((b) => !isPluginBinding(b)),                    // first-party, in registry order
  ...bindings.filter(isPluginBinding).sort(byInstallOrderThenId),    // plugins, deterministic
]
```

`byInstallOrderThenId` needs a stable tiebreak that survives reboots. Installation time from the
lockfile is the natural key (`installedAt`, already in `<id>.lock.json` and already on the roster);
fall back to plugin id alphabetically when two are equal. **Do not** use registry or roster order —
both are assembly artefacts, and a chord that moves between two plugins on a reboot is a bug
nobody will diagnose.

The user override is applied inside `resolveKeybindings` before conflict detection, which is
already correct: an explicit override wins over any default, including a first-party one. Keep it
that way — a user who deliberately gives `⌘K` to a plugin has decided, and "protecting" them from
their own setting is the wrong behaviour.

### What a losing binding looks like

Unbound, not remapped, and visible. `resolveKeybindings` already returns
`{ ...binding, chord: null, conflict: <winner description> }`, and Settings → Shortcuts already
renders that with a `shortcut-conflict` class. The plugin's command still works — it is in the
palette, it just has no key. Phase 2 makes sure the user can see why and fix it in one click.

Do **not** auto-assign a fallback chord. Guessing a free chord for a plugin produces bindings
nobody chose and nobody can predict.

## Scope: `surface`

The existing `pane` scope compares `props.focusedPane` to `binding.pane`. For a plugin binding the
host supplies the pane id from the manifest surface, so a plugin cannot name a pane it does not
own — the same host-binding rule as everywhere else.

One thing this scope does *not* solve: while a plugin **frame** has focus, the shell's dispatcher
sees no keydown at all, because keydown inside an iframe does not bubble to the parent window. So
a `surface`-scoped binding on a frame surface is declared here and only actually fires after
[phase 3](./phase-3-frame-keys.md). Say that in the authoring docs rather than letting an author
discover it.

For descriptor-only plugins — no frames — `global` and `task` scopes work fully after this phase.

## Registration and the enabled check

The host adapter registers a real `KeybindingContribution` per manifest entry:

```ts
keybindingRegistry.register({
  id: `plugin.${pluginId}.${descriptor.command}`,
  command: qualifiedId(pluginId, descriptor.command),
  description: commandTitle,                    // reuse the command's title
  category: pluginName,                          // groups the Settings list by plugin
  defaultChord: descriptor.defaultChord,
  when: descriptor.when === 'surface' ? 'pane' : descriptor.when,
  ...(descriptor.surface ? { pane: descriptor.surface } : {}),
  active: () => pluginEnabledOnActiveNode(pluginId),
})
```

`active` is the existing per-binding predicate the dispatcher already honours, and it is the host's
function, not the plugin's. A disabled plugin's chords stop firing without unregistering, which
keeps the Settings list stable while a plugin is toggled.

`category: pluginName` is doing real work: `ShortcutsSettings` groups by category, so plugin
bindings land under the plugin's name instead of scattered through the core categories.

## Steps

1. `keybindings` in the manifest schema, with chord validation, the bare-key refusal, and the
   command cross-check.
2. A shared chord validator — the manifest needs it on the node, the settings UI needs it on the
   client. Put the parser in `@acorn/protocol` beside the other shared contracts rather than
   duplicating the rules.
3. Deterministic ordering in `resolveKeybindings` (first-party, then plugins by install order).
4. Host adapter registering bindings, disposing with the plugin.
5. Docs: manifest reference, and `docs/command-palette-and-shortcuts.md` gains a precedence
   paragraph.

## Tests

- Manifest: valid chord accepted; unnormalised (`Meta+Shift+F`), bare key, unknown modifier,
  multi-key sequence all rejected; a binding naming an undeclared command rejected.
- Precedence, as a table test over `resolveKeybindings`: a plugin binding colliding with a
  first-party one loses; two plugins colliding resolve by install order and the result is stable
  when the input order is shuffled; a user override wins over both; an override that collides is
  reported rather than applied silently.
- Dispatcher: a `global` plugin binding fires; the same binding does not fire while a typing target
  is focused; `active` false stops it.
- Disable/enable: chords stop and resume without the Settings list changing shape.
- e2e: a fixture plugin's chord runs its command; installing a second fixture that wants the same
  chord leaves the first working and the second unbound with a conflict shown.

## Exit criteria

- A loaded plugin binds a chord that works, and cannot take one that already worked.
- Resolution is deterministic across reboots.
- A losing binding is unbound, labelled, and fixable — never silently remapped.
