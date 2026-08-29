// The installed keymap, and the one thing a kit node does with it: bind a run of intents to an
// element.
//
// Split from `install.ts` so the kit can reach it. `ui/` is pure presentation, props in and DOM out,
// and the arch rule in `tools/arch/boundaries.test.ts` holds it to that. Everything here is the
// engine and the key table; the installer, which reads the command and keybinding registries, and
// the region store, which reads the task state, stay on the other side of that line.

import { onCleanup, onMount } from 'solid-js'
import type { Binding, Keymap, TargetMode } from '@opentui/keymap'
import type { HtmlKeymapEvent } from '@opentui/keymap/html'
import { isTypingTarget } from '../lib/isTypingTarget'
import { BARE_KEYS, intentKeys } from './keymap'
import type { Intent } from './intents'

export type AcornKeymap = Keymap<HTMLElement, HtmlKeymapEvent>

let installed: AcornKeymap | null = null

/** The installed keymap, or null before the shell root exists. */
export const keymap = (): AcornKeymap | null => installed

/** Called by `install.ts` only. Returns the teardown that clears the singleton again. */
export function setKeymap(engine: AcornKeymap | null): () => void {
  installed = engine
  return () => { if (installed === engine) installed = null }
}

/** The intent-to-key table for this host, against the platform the keymap reports. */
export const keysFor = (): Record<Intent, readonly string[]> =>
  intentKeys(installed?.getHostMetadata().primaryModifier === 'super' ? 'super' : 'ctrl')

/**
 * Bind a run of intents to an element, as a focus-within layer.
 *
 * `handle` returns whether it took the intent. Returning false lets it bubble, which is what an empty
 * list, or a collection with no expandable rows, wants.
 *
 * Called from a `ref`, and so deferred to `onMount`: a Solid ref fires while the element is still
 * detached, and the keymap refuses a target that is not in the document. The caller's scope owns the
 * teardown, so there is nothing to return.
 */
export function bindIntents(
  element: HTMLElement,
  intents: readonly Intent[],
  handle: (intent: Intent) => boolean,
  options: { priority?: number; mode?: TargetMode } = {},
): void {
  onMount(() => onCleanup(registerIntentLayer(element, intents, handle, options)))
}

export function registerIntentLayer(
  element: HTMLElement,
  intents: readonly Intent[],
  handle: (intent: Intent) => boolean,
  options: { priority?: number; mode?: TargetMode } = {},
): () => void {
  const map = keysFor()
  const bindings: Binding<HTMLElement, HtmlKeymapEvent>[] = []
  for (const intent of intents) {
    for (const key of map[intent]) {
      bindings.push({
        key,
        cmd: () => handle(intent),
        // A bare key is a character somebody may be typing. The engine has no opinion about that, so
        // the binding carries one.
        ...(BARE_KEYS.has(key) ? { active: () => !isTypingTarget(document.activeElement) } : {}),
      })
    }
  }
  return installed?.registerLayer({
    target: element,
    targetMode: options.mode ?? 'focus-within',
    priority: options.priority ?? 40,
    bindings,
  }) ?? (() => {})
}
