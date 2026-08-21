// The Monaco theme, defined once. It used to be copied verbatim into EditorPane.tsx and
// DatabasePane.tsx, both writing the same Monaco theme global and working only because the two
// copies happened to agree (docs/third-party/monaco.md § What is already true).
//
// Monaco (like xterm) ignores CSS custom properties, so it gets an explicit theme: base vs/vs-dark
// supplies the syntax colours, chrome colours come from the live app tokens (tokens-layout.css),
// the same recipe terminal/theme.ts uses. Re-defining 'app' on a theme change updates it in place,
// and because the name is global every editor instance follows.
import * as monaco from 'monaco-editor'
import { isAppDark, token, watchAppearance } from '../ui/appearance'

export const MONACO_THEME = 'app'

export function applyMonacoTheme(): void {
  monaco.editor.defineTheme(MONACO_THEME, {
    base: isAppDark() ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': token('--bg'),
      'editor.foreground': token('--text'),
      'editorCursor.foreground': token('--text'),
      'editorLineNumber.foreground': token('--text-faint'),
      'editorLineNumber.activeForeground': token('--text-muted'),
      'editor.lineHighlightBackground': token('--bg-hover'),
      'editor.selectionBackground': token('--bg-selected'),
    },
  })
  monaco.editor.setTheme(MONACO_THEME)
}

/**
 * Apply the theme now and again on every appearance change. Returns an unsubscribe.
 *
 * The pair was always written out by hand at both call sites, which is one more place for one of them
 * to forget the initial apply and render a default-themed editor until the reader toggled something.
 */
export function watchMonacoTheme(): () => void {
  applyMonacoTheme()
  return watchAppearance(applyMonacoTheme)
}
