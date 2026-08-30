// The editor's look, defined once and shared by both instances (docs/editor.md § The shared surface).
//
// CodeMirror, like Monaco before it and like xterm, does not read our CSS custom properties: it
// builds its own stylesheet from a JS object. So the chrome colours are read out of the live app
// tokens (tokens-theme.css) and handed over, the same recipe terminal/theme.ts uses. Syntax colours
// come from a highlight style rather than a colour list, because CodeMirror colours by Lezer tag.
//
// The theme is per view, not global the way Monaco's named themes were. A compartment is what makes
// it swappable in place, and one compartment instance serves every view: it is a key, and each
// editor state stores its own contents under it.
import { Compartment, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { isAppDark, token, watchAppearance } from '../../kit/tokens/appearance'

const appearance = new Compartment()

function currentTheme(): Extension {
  const dark = isAppDark()
  return [
    EditorView.theme({
      '&': { color: token('--text'), backgroundColor: token('--bg') },
      '.cm-content': { caretColor: token('--text'), fontFamily: token('--font-mono') },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: token('--text') },
      '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: token('--bg-selected') },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: token('--bg-selected') },
      '.cm-activeLine': { backgroundColor: token('--bg-hover') },
      '.cm-gutters': { backgroundColor: token('--bg'), color: token('--text-faint'), borderRight: `1px solid ${token('--border')}` },
      '.cm-activeLineGutter': { backgroundColor: token('--bg-hover'), color: token('--text-muted') },
      '.cm-panels': { backgroundColor: token('--bg-subtle'), color: token('--text') },
      '.cm-tooltip': { backgroundColor: token('--bg-subtle'), color: token('--text'), border: `1px solid ${token('--border-strong')}` },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: token('--bg-selected'), color: token('--text') },
    }, { dark }),
    // `fallback: true` so the light default only paints tags the dark style did not, and vice versa;
    // basicSetup registers the light default too and this keeps the two from fighting.
    syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true }),
  ]
}

/** The theme extension, already carrying the appearance the app is wearing right now. */
export const editorTheme = (): Extension => appearance.of(currentTheme())

/**
 * Re-read the tokens into a view that already has the extension.
 *
 * The pane needs this by hand because it caches a state per open file, and a state built while the
 * app was light keeps its light theme in the compartment until something reconfigures it. Swapping
 * to a stale tab is exactly that something.
 */
export const refreshEditorTheme = (view: EditorView): void => {
  view.dispatch({ effects: appearance.reconfigure(currentTheme()) })
}

/**
 * Keep a view's theme in step with the app's, and hand back an unsubscribe.
 *
 * `editorTheme()` above is the initial apply, so unlike the Monaco pair this one has no way to be
 * half-wired: a view built without the extension has no compartment to reconfigure and a view built
 * with it is already themed.
 */
export function watchEditorTheme(view: EditorView): () => void {
  return watchAppearance(() => refreshEditorTheme(view))
}
