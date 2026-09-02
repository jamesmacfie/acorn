// The editor surface, on a host with no CodeMirror in it. `@acorn/plugin-api/ui/editor` resolves here,
// the same swap `./ui.ts` and `./host.tsx` make for the kit and the chrome (docs/tui.md § The host
// switch).
//
// Why it exists. The facade's real half is a grammar per language and a stylesheet built from CSS
// custom properties, and neither means anything in cells: this host's `editor` rectangle draws the
// file read-only and hands the reader's own `$EDITOR` a PTY when they want to type (./rectangle.tsx,
// docs/editor.md § Editing in your own editor). Left unaliased, `EditorPane.tsx` reached the real
// module and the terminal client carried seventeen CodeMirror grammars and a colour theme it has no
// way to draw (docs/future/performance/decisions.md § Registries hold loaders).
//
// A module rather than an empty alias, with the facade's names and the facade's types, so
// `EditorPane.tsx` compiles and runs unchanged and this host loses no feature. The CodeMirror types
// are type-only imports and are erased, so nothing below puts a byte of the library in the bundle.
//
// The ceiling: CodeMirror itself still arrives, because `EditorPane.tsx` imports `basicSetup`,
// `EditorState` and `EditorView` directly rather than through this facade. Nothing on this host calls
// the code that uses them — `stateFor` runs only once `mountEditor` has a view, and the `editor`
// rectangle never mounts one — so it is bytes in a lazy chunk rather than work. Routing those three
// through the facade too is what would let this host drop the library, and nothing has asked for it.
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type { EditorViewState } from '@acorn/client-core/features/editor/viewState.ts'
import type { EditorViewState } from '@acorn/client-core/features/editor/viewState.ts'

/** No grammar, because there is no highlighter to give one to. An empty extension is a real answer
 *  here in the way `plaintext` is a real answer on the DOM, not a missing one. */
export const languageForPath = (_path: string): Promise<Extension> => Promise.resolve([])

/** The palette is already the terminal's: OpenTUI paints from the same theme tokens the rest of this
 *  host reads (./roles.ts), and there is no second stylesheet to hand a colour list to. */
export const editorTheme = (): Extension => []

export const refreshEditorTheme = (_view: EditorView): void => {}

/** A watcher that has nothing to watch. It still returns the stop function, because the caller stores
 *  it and calls it on cleanup. */
export const watchEditorTheme = (_view: EditorView): (() => void) => () => {}

export const captureViewState = (_view: EditorView): EditorViewState => ({ anchor: 0, head: 0, scrollTop: 0 })

export const applyViewState = (_view: EditorView, _state: EditorViewState): void => {}
