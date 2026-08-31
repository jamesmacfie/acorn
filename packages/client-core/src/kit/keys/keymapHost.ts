// The installed keymap, and the one thing a kit node does with it: bind a run of intents to a
// target.
//
// Split from `install.ts` so the kit can reach it. `ui/` is pure presentation, props in and DOM out,
// and the arch rule in `tools/arch/boundaries.test.ts` holds it to that. Everything here is the
// engine and the key table; the installer, which reads the command and keybinding registries, and
// the region store, which reads the task state, stay on the other side of that line.
//
// A target is whatever the host's adapter focuses. The DOM's is an `HTMLElement` and the terminal's
// is an OpenTUI `Renderable`, so nothing in this file names either: the host supplies its pair at
// `setKeymap` and its own answer to "is somebody typing right now", which is the only question a
// binding asks about the focused thing.

import { onCleanup, onMount } from 'solid-js'
import type { Binding, Keymap, KeymapEvent, TargetMode } from '@opentui/keymap'
import type { HtmlKeymapEvent } from '@opentui/keymap/html'
import { BARE_KEYS, intentKeys } from './keymap'
import type { Intent } from './intents'

/** The engine, at a host's pair of type parameters. The DOM's pair is the default, because it is
 *  what every caller in this package means. */
export type AcornKeymap<
  Target extends object = HTMLElement,
  Event extends KeymapEvent = HtmlKeymapEvent,
> = Keymap<Target, Event>

// Held at the widest pair the engine allows, because there is one engine per process and the host
// that installed it is the only thing that knows which pair it is.
let installed: Keymap<object, KeymapEvent> | null = null
// Whether the focused thing takes text. The DOM asks `isTypingTarget(document.activeElement)`; the
// terminal asks whether the focused renderable is an input or a textarea. Same question, and the
// only one a bare-key binding needs.
let typing: () => boolean = () => false
// Which modifier this host's chords are spelled with. The engine reports the *platform's* primary
// modifier, which on macOS is `super`, and that is right in a browser and wrong in a terminal: a
// terminal emulator keeps Cmd for itself and never delivers it, so `super+return` is a chord nobody
// can press. So a host may say. Nothing supplies it but the terminal
// (docs/tui.md § The adapter).
let primary: 'super' | 'ctrl' | null = null

/** The installed keymap, or null before the host's root exists. */
export const keymap = <
  Target extends object = HTMLElement,
  Event extends KeymapEvent = HtmlKeymapEvent,
>(): AcornKeymap<Target, Event> | null => installed as AcornKeymap<Target, Event> | null

/** Called by a host's installer only. Returns the teardown that clears the singleton again. */
export function setKeymap<Target extends object, Event extends KeymapEvent>(
  engine: Keymap<Target, Event> | null,
  host: { typing: () => boolean; primary?: 'super' | 'ctrl' } = { typing: () => false },
): () => void {
  const held = engine as Keymap<object, KeymapEvent> | null
  installed = held
  typing = host.typing
  primary = host.primary ?? null
  return () => {
    if (installed !== held) return
    installed = null
    typing = () => false
    primary = null
  }
}

/** Whether the focused thing takes text, as the host answers it. Read by the bare-key bindings and
 *  by anything else that has to keep out of somebody's way while they type. */
export const isTyping = (): boolean => typing()

/** The intent-to-key table for this host: what the host said, else the platform the keymap reports. */
export const keysFor = (): Record<Intent, readonly string[]> =>
  intentKeys(primary ?? (installed?.getHostMetadata().primaryModifier === 'super' ? 'super' : 'ctrl'))

/**
 * Bind a run of intents to a target, as a focus-within layer.
 *
 * `handle` returns whether it took the intent. Returning false lets it bubble, which is what an empty
 * list, or a collection with no expandable rows, wants.
 *
 * Called from a `ref`, and so deferred to `onMount`: a Solid ref fires while the element is still
 * detached, and the DOM keymap refuses a target that is not in the document.
 * The caller's scope owns the teardown, so there is nothing to return.
 */
export function bindIntents<Target extends object>(
  target: Target,
  intents: readonly Intent[],
  handle: (intent: Intent) => boolean,
  options: { priority?: number; mode?: TargetMode } = {},
): void {
  onMount(() => onCleanup(registerIntentLayer(target, intents, handle, options)))
}

export function registerIntentLayer<Target extends object>(
  target: Target,
  intents: readonly Intent[],
  handle: (intent: Intent) => boolean,
  options: { priority?: number; mode?: TargetMode } = {},
): () => void {
  const map = keysFor()
  const bindings: Binding<object, KeymapEvent>[] = []
  for (const intent of intents) {
    for (const key of map[intent]) {
      bindings.push({
        key,
        cmd: () => handle(intent),
        // A bare key is a character somebody may be typing. The engine has no opinion about that, so
        // the binding carries one.
        ...(BARE_KEYS.has(key) ? { active: () => !typing() } : {}),
      })
    }
  }
  return installed?.registerLayer({
    target,
    targetMode: options.mode ?? 'focus-within',
    priority: options.priority ?? 40,
    bindings,
  }) ?? (() => {})
}
