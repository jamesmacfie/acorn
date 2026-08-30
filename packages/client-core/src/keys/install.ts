// The keymap, installed once at the shell root.
//
// One engine for the whole app (docs/command-palette-and-shortcuts.md § Focus and typing, on layers over
// the same tree). `@opentui/keymap` holds the layers, the command catalog and the diagnostics; its
// HTML adapter turns DOM keydowns into keymap events and tracks targets with a MutationObserver, and
// its terminal adapter, which we do not use yet, is in the same package. Nothing here is an adapter
// of ours, which is the point of adopting it rather than writing one.
//
// Four tiers of layer, ordered by priority because the engine sorts on that and not on how local a
// layer is:
//
//   0   the command layer: acorn's resolved keybindings, one binding each, gated by a matcher that
//       reproduces the scope rules exactly as the old window listener did
//   5   the region chords, global, because moving between regions has to work from anywhere
//   30  a pane's own layer, focus-within on the pane element: the `tabs` layout's ⌘1..⌘9, which is
//       the only one so far (../layouts/Tabs.tsx)
//   40  a kit collection's intents, focus-within on the collection
//
// A binding whose handler returns false is not handled, so dispatch carries on to the next layer.
// That is how an intent bubbles: the focused collection answers it, or its ancestors do, or the
// region layer does, or nothing does.

import { createEffect, onCleanup } from 'solid-js'
import { createDefaultHtmlKeymap, type HtmlKeymapEvent } from '@opentui/keymap/html'
import type { Binding } from '@opentui/keymap'
import { isTypingTarget } from '@acorn/protocol/keybindings.ts'
import { commandAvailable, commandRegistry, commandTitle, executeCommand } from '../registries/commands'
import type { ResolvedKeybinding } from '../registries/keybindings'
import { isTerminalTarget, setKeymap } from './host'
import { intentKeys, toKeymapKey } from './keymap'
import type { Intent } from './intents'
import { moveRegion, movePane } from './regions'

// The engine and the intent binder live in `host.ts`, which the kit may import; this module reads the
// command and keybinding registries and so may not be imported from `ui/`.
export { isTerminalTarget, keymap, keysFor, registerIntentLayer, type AcornKeymap } from './host'

export type ScopeContext = {
  prefs: () => { taskActive: boolean; focusedPane?: string }
  bindings: () => readonly ResolvedKeybinding[]
}

/** The old dispatcher's `scopeActive`, as a matcher. Reads the focused element rather than an event
 *  target because a matcher runs during dispatch, when they are the same thing. */
const scopeActive = (binding: ResolvedKeybinding, context: ScopeContext, event: () => HtmlKeymapEvent | null): boolean => {
  if (binding.active && !binding.active()) return false
  const scope = binding.when ?? 'global'
  const { taskActive, focusedPane } = context.prefs()
  if (scope === 'task' && !taskActive) return false
  if (scope === 'pane' && (!taskActive || focusedPane !== binding.pane)) return false
  const target = document.activeElement
  // An open overlay answers its own Escape, and `ui/dismissable.ts` keeps a stack of them so a pile
  // unwinds one press at a time. The keymap must not claim the press first, and it cannot hand it
  // back either: consuming a key here stops the DOM event as well.
  if (binding.chord === 'escape' && target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]')) return false
  if (!isTypingTarget(target)) return true
  // xterm focuses a hidden textarea, so a terminal reads as a typing target; a command chord there is
  // never terminal input on macOS, so it still fires. See `isTerminalTarget` in ./host.ts.
  if (scope !== 'global' && !(event()?.super && isTerminalTarget(target))) return false
  return scope !== 'typing-exempt'
}

/**
 * Install the keymap on `root` and keep its layers in step with the command and keybinding
 * registries. Returns nothing: the caller's reactive scope owns the teardown.
 */
export function installKeymap(root: HTMLElement, context: ScopeContext): void {
  const engine = createDefaultHtmlKeymap(root)
  onCleanup(setKeymap(engine))

  // Per-binding gating. `registerEnabledFields` only reaches layers and commands, and acorn's scopes
  // are a property of one binding.
  onCleanup(engine.registerBindingFields({
    active(value, ctx) { ctx.activeWhen(value as () => boolean) },
  }))

  // The event under dispatch, for the one matcher that needs a modifier off it. Recorded rather than
  // threaded, because a binding's activity matcher takes no arguments.
  let current: HtmlKeymapEvent | null = null
  onCleanup(engine.intercept('key', (ctx) => { current = ctx.event }, { priority: 100 }))

  // Region and pane chords. Global, because they are how you get back to a region you can no longer
  // see, and typing-exempt because they have to work from inside a composer.
  const map = intentKeys(engine.getHostMetadata().primaryModifier === 'super' ? 'super' : 'ctrl')
  const moves: [Intent, () => boolean][] = [
    ['nextRegion', () => moveRegion(1)],
    ['prevRegion', () => moveRegion(-1)],
    ['nextPane', () => movePane(1)],
    ['prevPane', () => movePane(-1)],
  ]
  onCleanup(engine.registerLayer({
    priority: 5,
    bindings: moves.flatMap(([intent, run]) => map[intent].map((key) => ({ key, cmd: run }))),
  }))

  // The command catalog and the bindings that reach it, rebuilt whenever either registry or the
  // user's overrides change. One layer rather than one per scope: the scope lives on the binding.
  createEffect(() => {
    const commands = commandRegistry.entries().map((command) => ({
      name: command.id,
      desc: commandTitle(command),
      group: command.category,
      enabled: () => commandAvailable(command),
      run: () => { void executeCommand(command.id).catch((error) => console.error(`[command:${command.id}]`, error)) },
    }))
    const bindings = context.bindings().flatMap((binding): Binding<HTMLElement, HtmlKeymapEvent>[] => {
      const key = binding.chord && toKeymapKey(binding.chord)
      if (!key) return []
      return [{
        key,
        cmd: binding.command,
        desc: binding.description,
        group: binding.category,
        active: () => scopeActive(binding, context, () => current),
      }]
    })
    onCleanup(engine.registerLayer({ priority: 0, commands, bindings }))
  })
}
