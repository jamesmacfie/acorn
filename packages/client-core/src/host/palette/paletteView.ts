import { onCleanup, onMount } from 'solid-js'
import { commandRegistry } from '../registries/commands/commands'
import { keybindingRegistry } from '../registries/commands/keybindings'
import {
  createCommandSession,
  type CommandSession,
  type CommandSessionOptions,
} from '../registries/commands/session'
import { createOverlayFocus, type PaletteView } from './overlay'

// The desktop's adapter onto the palette session.
//
// Everything in here is DOM: which element had focus before the palette opened, which overlay is the
// open one, and how a `keydown` becomes a session operation. Nothing in here decides what a row is,
// what order the rows come in, or what pressing Enter on one does — that is the session, and the
// terminal binds the same operations to its own keys (apps/tui/src/chrome/Palette.tsx).
//
// It is not `createOverlayPalette`. That hook holds the query and the cursor in two signals of its
// own, which is right for a file finder and wrong here: a palette that pushes a group has to restore
// the parent's query and the parent's cursor on the way back, and those belong to the frame. What the
// two do share — the focus rules — is `createOverlayFocus` and is written once.

export type CommandPaletteView = {
  session: CommandSession
  view: PaletteView
}

/**
 * Wire a session to the chord that opens it and the surface that draws it.
 *
 * `id` becomes `overlay.<id>.toggle` for both the command and the keybinding, which is what
 * `createOverlayPalette` produced before and therefore what a reader's saved override is keyed on
 * (docs/command-palette-and-shortcuts.md § Plugin shortcuts, on binding ids as persistence keys).
 * Changing it would silently unbind everybody's ⌘K.
 */
export function createCommandPaletteView(options: CommandSessionOptions & {
  id: string
  title: string
  toggleChord: string
}): CommandPaletteView {
  // Declared before the session and reading it lazily: `createOverlayFocus` wants the close it should
  // call when another overlay takes over, and the session wants the focus hooks. One of the two has to
  // be named before it exists, and a closure is the honest way to do it.
  const focus = createOverlayFocus(() => session.close())
  const session = createCommandSession({
    ...options,
    onOpen: () => {
      focus.claim()
      options.onOpen?.()
    },
    onClose: () => {
      focus.release()
      options.onClose?.()
    },
  })

  onMount(() => {
    const command = commandRegistry.register({
      id: `overlay.${options.id}.toggle`,
      title: options.title,
      category: 'navigation',
      run: () => (session.open() ? session.close() : session.openRoot()),
    })
    const binding = keybindingRegistry.register({
      id: `overlay.${options.id}.toggle`,
      command: `overlay.${options.id}.toggle`,
      description: options.title,
      category: 'Global',
      defaultChord: options.toggleChord,
      when: 'global',
    })
    onCleanup(() => { binding.dispose(); command.dispose() })
  })

  const view: PaletteView = {
    open: session.open,
    query: session.query,
    sel: session.selectedIndex,
    setSel: (index) => {
      const row = session.rows()[index]
      if (row) session.select(row.id)
    },
    setQuery: session.setQuery,
    close: session.close,
    setInputRef: focus.setInputRef,
    onDialogMouseDown: focus.onDialogMouseDown,
    onKeyDown: (event) => {
      if (!session.open()) return
      // The input owns typing; only the four navigation keys are intercepted. Backspace is not one of
      // them: an empty query plus Backspace edits text, and Escape is the single way back
      // (docs/future/command-palette/architecture.md § Palette session).
      if (event.key === 'Escape') {
        event.preventDefault()
        session.back()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        session.move(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        session.move(-1)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        session.activate()
      }
    },
  }

  return { session, view }
}
