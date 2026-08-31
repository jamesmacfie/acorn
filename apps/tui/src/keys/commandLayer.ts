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
import type { Binding } from '@opentui/keymap'
import type { KeyEvent, Renderable } from '@opentui/core'
import { isTyping } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { toKeymapKey } from '@acorn/client-core/kit/keys/keymap.ts'
import {
  commandAvailable, commandRegistry, commandTitle, executeCommand,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import {
  keybindingRegistry, resolveKeybindings, type KeybindingPrefs, type ResolvedKeybinding,
} from '@acorn/client-core/host/registries/commands/keybindings.ts'
import type { TuiKeymap } from './install'

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
 */
export function installCommandLayer(engine: TuiKeymap, scope: CommandScope): void {
  createEffect(() => {
    const commands = commandRegistry.entries().map((command) => ({
      name: command.id,
      desc: commandTitle(command),
      group: command.category,
      enabled: () => commandAvailable(command),
      run: () => { void executeCommand(command.id).catch((error) => console.error(`[command:${command.id}]`, error)) },
    }))
    const bindings = resolveKeybindings(keybindingRegistry.entries(), scope.prefs())
      .flatMap((binding): Binding<Renderable, KeyEvent>[] => {
        const key = binding.chord && toKeymapKey(binding.chord)
        if (!key) return []
        // No `desc` or `group` on the binding, unlike the DOM installer's: this engine's compiler
        // has no field for either and drops them with a warning, and the command they resolve to
        // carries both anyway, which is where the footer reads them from (../chrome/bindings.ts).
        return [{
          key,
          cmd: binding.command,
          active: () => mayFire(binding, scope) && !(isBareKey(key) && isTyping()),
        }]
      })
    onCleanup(engine.registerLayer({ priority: 0, commands, bindings }))
  })
}
