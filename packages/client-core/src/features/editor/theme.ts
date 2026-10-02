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
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { isAppDark, token, watchAppearance } from '../../kit/tokens/appearance'

const appearance = new Compartment()

// Syntax colours, one role per line, in the GitHub palette shiki already paints diffs and markdown
// fences with (infra/highlight/shiki.ts). Sharing the palette is the point: the same file used to
// come out one colour in a diff and another in the editor, because nothing connected the two.
//
// These are a fixed light/dark pair rather than app tokens, for the same reason the shiki side is:
// the twelve themes declare 21 chrome colours between them and none of them says what a string
// literal looks like.
type Palette = {
  comment: string
  keyword: string
  string: string
  literal: string
  name: string
  tag: string
  invalid: string
}

const LIGHT: Palette = {
  comment: '#6a737d',
  keyword: '#d73a49',
  string: '#032f62',
  literal: '#005cc5',
  name: '#6f42c1',
  tag: '#22863a',
  invalid: '#b31d28',
}

const DARK: Palette = {
  comment: '#6a737d',
  keyword: '#f97583',
  string: '#9ecbff',
  literal: '#79b8ff',
  name: '#b392f0',
  tag: '#85e89d',
  invalid: '#fdaeb7',
}

// Plain identifiers and operators are deliberately absent, so they keep the theme's own --text and
// code does not turn into a rainbow. That is what GitHub does too.
//
// The markdown rules earn their place: a document is the file this app opens most, and CodeMirror's
// bundled styles underline every heading and every link label, which is what the reader sees before
// they see any colour. Here the marks around a link go grey, the label takes the link colour, and
// only the URL keeps an underline.
const highlightStyle = (c: Palette): HighlightStyle => HighlightStyle.define([
  { tag: t.comment, color: c.comment },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier], color: c.keyword },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape], color: c.string },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.self, t.constant(t.name), t.standard(t.name)], color: c.literal },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: c.literal },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.namespace, t.macroName, t.annotation], color: c.name },
  { tag: [t.tagName, t.angleBracket, t.quote, t.inserted], color: c.tag },
  { tag: [t.deleted, t.invalid], color: c.invalid },
  { tag: [t.processingInstruction, t.contentSeparator], color: c.comment },
  { tag: t.heading, color: c.literal, fontWeight: 'bold' },
  { tag: [t.monospace, t.link], color: c.literal },
  { tag: t.url, color: c.literal, textDecoration: 'underline' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
])

const LIGHT_SYNTAX = highlightStyle(LIGHT)
const DARK_SYNTAX = highlightStyle(DARK)

/** A token, thinned out. Used where something has to sit behind the text without hiding it. */
const wash = (name: string, percent: number): string =>
  `color-mix(in srgb, ${token(name)} ${percent}%, transparent)`

function currentTheme(): Extension {
  const dark = isAppDark()
  return [
    EditorView.theme({
      // The diff's code size, so a line opened from the diff keeps its size in the editor.
      '&': { color: token('--text'), backgroundColor: token('--bg'), fontSize: token('--fs-sm') },
      '.cm-content': { caretColor: token('--text'), fontFamily: token('--font-mono') },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: token('--text') },
      // Selecting inside one line used to show nothing at all, and the four rules below are why.
      //
      // CodeMirror draws the selection as rectangles in a layer under `.cm-content`, so an opaque
      // background on a line paints straight over it. The line a selection sits on is the line the
      // cursor is on, so `.cm-activeLine` hid every selection that fitted inside one line, while a
      // selection across several lines showed on all but its last and looked fine. The current line
      // has nothing to say while text is selected, so it stands down for as long as the selection
      // layer has anything in it, and keeps its full-strength colour the rest of the time.
      //
      // The selection itself takes the accent rather than another step on the grey ramp, and
      // `.cm-selectionMatch` — the other copies of the selected word, which only ever appear for a
      // one-line selection — takes a weaker version of the same colour, so the two read as one
      // idea. Its stock colour is a lime green that belongs to no theme here.
      //
      // The focused selection spells its selector out because CodeMirror's base theme names the
      // whole path for that one, and a shorter selector loses to it on specificity no matter which
      // sheet comes last. Matching the shape is what puts us on top.
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: wash('--accent', 34) },
      '.cm-selectionBackground': { backgroundColor: token('--bg-selected') },
      '.cm-selectionMatch': { backgroundColor: wash('--accent', 16) },
      '.cm-activeLine': { backgroundColor: token('--bg-hover') },
      '&:has(.cm-selectionBackground) .cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-gutters': { backgroundColor: token('--bg'), color: token('--text-faint'), borderRight: `1px solid ${token('--border')}` },
      '.cm-activeLineGutter': { backgroundColor: token('--bg-hover'), color: token('--text-muted') },
      '.cm-panels': { backgroundColor: token('--bg-subtle'), color: token('--text') },
      '.cm-tooltip': { backgroundColor: token('--bg-subtle'), color: token('--text'), border: `1px solid ${token('--border-strong')}` },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: token('--bg-selected'), color: token('--text') },
    }, { dark }),
    // Not `fallback: true`, and that is the whole fix for an editor that drew no colour. The fallback
    // facet keeps one value, the first, and `basicSetup` registers CodeMirror's own light default
    // ahead of this extension — so for as long as both were fallbacks, every file in every theme was
    // painted by a style built for a white page, underlines and all.
    syntaxHighlighting(dark ? DARK_SYNTAX : LIGHT_SYNTAX),
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
