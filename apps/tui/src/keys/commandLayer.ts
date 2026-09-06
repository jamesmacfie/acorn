// The command layer: tier 0, acorn's resolved keybindings over the command registry.
//
// The desktop builds the same layer inside `client-core/host/keys/install.ts`, and it is not shared
// because the half that decides whether a binding may fire is DOM all the way down: it reads
// `document.activeElement`, asks whether that element is inside a `[role="dialog"]`, and has a special
// case for the hidden textarea xterm focuses. None of those questions exist here, and the two that do
// — "is a task open" and "which pane has focus" — are the shell's own signals.
//
// What is shared is everything worth sharing: the registries, `resolveKeybindings` with the user's
// overrides and its conflict rule, and `toKeymapKey`, which spells an acorn chord the way the engine
// wants it. A second chord table would be a second thing that drifts.

import { createEffect, onCleanup } from 'solid-js'
import type { Binding, Command } from '@opentui/keymap'
import type { Renderable } from '../tree/compat'
import type { KeyEvent } from '../keyEvent'
import { toKeymapKey } from '@acorn/client-core/kit/keys/keymap.ts'
import {
  commandAvailable, commandRegistry, commandTitle, executeCommand,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import {
  keybindingRegistry, resolveKeybindings, type KeybindingPrefs, type ResolvedKeybinding,
} from '@acorn/client-core/host/registries/commands/keybindings.ts'
import type { TuiKeymap } from './install'
import { scopeDepth } from './regions'
import { COMMAND } from './tiers'

export type CommandScope = {
  prefs: () => KeybindingPrefs
  /** Is a task open, rather than a browse source? Gates the `task` scope. */
  taskActive: () => boolean
  /** The pane the keys are in, for the `pane` scope. */
  focusedPane: () => string | undefined
}

/** A chord with no modifier is a character somebody may be typing, so it waits until nobody is. The
 *  same rule `BARE_KEYS` states for the intent bindings, asked of the key rather than of a list,
 *  because a plugin may bind a bare key this host has never heard of. */
const isBareKey = (key: string): boolean => !key.includes('+')

/**
 * The command key, read as Ctrl.
 *
 * A terminal emulator keeps Cmd for itself and never delivers it, so `super+shift+r` is a chord nobody
 * can press — and half the panes in the roster spell their own as `meta+shift+…`, which is acorn's
 * name for the platform's command key and comes out of `toKeymapKey` as `super` on macOS. The intent
 * table already asks this host which modifier it has and is told `ctrl` (../keys/install.ts); a
 * contribution's own chord is a literal and had to be read the same way, or the footer advertises keys
 * that do nothing (docs/tui.md).
 *
 * Collisions are possible and are the lesser problem: `resolveKeybindings` already reports two bindings
 * on one chord, and a duplicate that shows up in the conflict list beats a chord that silently never
 * fires.
 */
const asCtrl = (key: string): string => (key.startsWith('super+') ? `ctrl+${key.slice('super+'.length)}` : key)

const mayFire = (binding: ResolvedKeybinding, scope: CommandScope): boolean => {
  if (binding.active && !binding.active()) return false
  const when = binding.when ?? 'global'
  if (when === 'task' && !scope.taskActive()) return false
  if (when === 'pane' && (!scope.taskActive() || scope.focusedPane() !== binding.pane)) return false
  // Nothing here has to ask about a terminal. An entered `pty` rectangle takes every key before
  // dispatch reaches any layer, which is the whole Rectangle contract (../kit/rectangle.tsx).
  return true
}

/**
 * Register the command layer, and keep it in step with both registries and the user's overrides.
 *
 * The caller's reactive scope owns the teardown, which on this host is the process ending.
 *
 * **Nothing here carries a runtime matcher, and that is deliberate.** `@opentui/keymap` 0.5.9 counts
 * a layer, a command or a binding with a matcher as a reason to switch its active-key cache off, and
 * the counter is global — so one `active` or one `enabled` on one command in this layer turned the
 * cache off for every `getActiveKeys` call in the process, and the footer makes one per render
 * (../chrome/bindings.ts, ./tiers.ts § TYPING). This effect already re-runs when the registries or
 * the reader's overrides change; every other question a matcher was asking is a signal too, so the
 * effect reads them and the answers become which bindings the layer has rather than which of its
 * bindings may fire. The layer comes and goes where a matcher used to run per key, which is the same
 * trade the typing shadow makes one tier up.
 *
 * What that costs is a rebuild of this layer when any of those answers moves: a task opening, a
 * scope pushing, a route changing, a plugin's own `active` flipping. None of them is per key.
 */
export function installCommandLayer(engine: TuiKeymap, scope: CommandScope): void {
  createEffect(() => {
    // Read once, here, rather than per key from inside a matcher.
    const depth = scopeDepth()
    const commands = commandRegistry.entries()
      // `enabled` was this field's home and it was a matcher. A command the host cannot run is a
      // command the palette must not offer and the footer must not name, and dropping it from the
      // layer says that without one.
      .filter((command) => commandAvailable(command))
      .map((command): Command<Renderable, KeyEvent> => ({
        name: command.id,
        desc: commandTitle(command),
        group: command.category,
        run: () => { void executeCommand(command.id).catch((error) => console.error(`[command:${command.id}]`, error)) },
      }))
    const runnable = new Set(commands.map((command) => command.name))
    const bindings = resolveKeybindings(keybindingRegistry.entries(), scope.prefs())
      .flatMap((binding): Binding<Renderable, KeyEvent>[] => {
        const spelled = binding.chord && toKeymapKey(binding.chord)
        const key = spelled && asCtrl(spelled)
        if (!key) return []
        if (!mayFire(binding, scope) || !runnable.has(binding.command)) return []
        // A bare key belongs to the screen. `w`, `p`, `;`, `n`, `q` and `?` switch or open a picker,
        // and a reader who presses one inside a dialog meant the dialog. Before this, `w` over the trust prompt
        // raised the workspace picker on top of it. Chords stay live at every depth, because
        // Ctrl+K is not a key anything inside a dialog could want, and the collection layers
        // behind the dialog need no gate of their own: they are focus-within and the focus is
        // inside the dialog, so they never fire (./regions.ts § Scopes).
        //
        // The other half of the old gate, "not while somebody is typing", is the typing shadow's
        // now: it sits above this tier and claims every bare key while a field has the keys, so
        // this layer says nothing about typing at all (./tiers.ts § TYPING).
        if (isBareKey(key) && depth > 1) return []
        // No `desc` or `group` on the binding, unlike the DOM installer's: this engine's compiler
        // has no field for either and drops them with a warning, and the command they resolve to
        // carries both anyway, which is where the footer reads them from (../chrome/bindings.ts).
        return [{ key, cmd: binding.command }]
      })
    onCleanup(engine.registerLayer({ priority: COMMAND, commands, bindings }))
  })
}
