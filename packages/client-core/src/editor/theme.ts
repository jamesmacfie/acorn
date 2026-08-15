// The Monaco theme, defined once.
//
// It used to be copied verbatim into EditorPane.tsx and DatabasePane.tsx, and the database copy said
// so ("mirrored here to keep that pane untouched"). The duplication was load-bearing by accident: the
// theme NAME is a Monaco global, so two panes were writing the same global and it worked because both
// copies happened to agree. Last writer won, and nothing would have said otherwise
// (docs/third-party/monaco.md § What is already true).
//
// Monaco (like xterm) ignores CSS custom properties, so it gets an explicit theme: base vs/vs-dark
// supplies the syntax colours, chrome colours come from the live app tokens (tokens-layout.css) — the
// same recipe terminal/theme.ts uses. Re-defining 'app' on a theme change updates it in place, and
// because the name is global every editor instance follows.
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
