import type { Extension, EditorState, Text } from '@codemirror/state'
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search'
import { createSignal } from 'solid-js'
import type { FindPanelProps, FindSnapshot } from './FindPanel'

// Find and replace in every graphical editor, drawn with the kit's controls (docs/editor.md § Find in
// a file).
//
// CodeMirror keeps the query, the matching, the highlights, the selection, the replacement and undo.
// This file only reads its search state out for display and turns the reader's clicks into its own
// commands, through the one supported seam, `search({ createPanel })`. A replacement is an ordinary
// transaction, so it reaches each caller's update listener, autosave and undo history like a keystroke.
//
// The view is a `.tsx` module loaded on first use, not imported here. This module sits behind
// `@acorn/plugin-api/ui/editor`, which has to load in a plugin's node-environment tests, and JSX
// cannot. By the time anyone presses Cmd+F the editor has been on screen long enough for the view to
// have arrived, so in practice the panel draws synchronously.

/** Counting stops here and the bar shows a lower bound. Navigation does not depend on the count. */
export const MAX_COUNTED_MATCHES = 1000

type Matches = { ranges: { from: number; to: number }[]; more: boolean }

/** Every match of a query, using the engine's own cursor so the semantics cannot drift from its own. */
export function findMatches(state: EditorState, query: SearchQuery): Matches {
  const ranges: Matches['ranges'] = []
  const cursor = query.getCursor(state)
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (ranges.length === MAX_COUNTED_MATCHES) return { ranges, more: true }
    ranges.push(next.value)
  }
  return { ranges, more: false }
}

/** The 1-based position of the selection among the matches, or 0 when the selection is not one. */
function currentMatch(state: EditorState, ranges: Matches['ranges']): number {
  const { from, to } = state.selection.main
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const range = ranges[middle]!
    if (range.from < from) low = middle + 1
    else if (range.from > from) high = middle - 1
    else return range.to === to ? middle + 1 : 0
  }
  return 0
}

let view: typeof import('./FindPanel') | undefined
let loading: Promise<unknown> | undefined
const loadView = () =>
  (loading ??= import('./FindPanel').then((loaded) => {
    view = loaded
  }))

// Each view's open panel, so a Replace command can show the replace row of the panel it just opened.
const replaceOpeners = new WeakMap<EditorView, () => void>()

function createFindPanel(editor: EditorView): Panel {
  const dom = document.createElement('div')
  let field: HTMLInputElement | undefined
  let replaceField: HTMLInputElement | undefined
  // Presentation only, so it resets when the panel is rebuilt for another document. The replacement
  // text itself lives in the query, so collapsing the row keeps it.
  const [replacing, setReplacing] = createSignal(false)
  let focusTarget: 'find' | 'replace' = 'find'
  let mounted = false
  let destroyed = false
  let dispose: (() => void) | undefined

  // One count per document and query. A cursor move only searches the cached ranges.
  let counted: { doc: Text; query: SearchQuery; matches: Matches } | undefined
  const snapshot = (state: EditorState): FindSnapshot => {
    const query = getSearchQuery(state)
    const base = { query, readOnly: state.readOnly }
    if (!query.search) return base
    if (!query.valid) return { ...base, error: 'Invalid regular expression' }
    if (counted?.doc !== state.doc || !counted.query.eq(query))
      counted = { doc: state.doc, query, matches: findMatches(state, query) }
    const { ranges, more } = counted.matches
    return { ...base, count: { current: currentMatch(state, ranges), total: ranges.length, more } }
  }
  const [current, setCurrent] = createSignal(snapshot(editor.state))

  const change = (patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    const query = getSearchQuery(editor.state)
    editor.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: query.search,
          caseSensitive: query.caseSensitive,
          literal: query.literal,
          regexp: query.regexp,
          wholeWord: query.wholeWord,
          replace: query.replace,
          test: query.test,
          ...patch,
        }),
      ),
    })
  }

  const props: FindPanelProps = {
    snapshot: current,
    replacing,
    setReplacing,
    field: (element) => {
      field = element
    },
    replaceField: (element) => {
      replaceField = element
    },
    change,
    next: () => findNext(editor),
    previous: () => findPrevious(editor),
    selectAll: () => selectMatches(editor),
    replaceNext: () => replaceNext(editor),
    replaceAll: () => replaceAll(editor),
    close: () => closeSearchPanel(editor),
  }

  const focusField = () => {
    const target = focusTarget === 'replace' ? replaceField : field
    target?.focus()
    target?.select()
  }
  const openReplace = () => {
    if (editor.state.readOnly) return
    focusTarget = 'replace'
    setReplacing(true)
    focusField()
  }
  replaceOpeners.set(editor, openReplace)
  const draw = () => {
    if (destroyed || dispose || !view) return
    dispose = view.renderFindPanel(dom, props)
    if (mounted) focusField()
  }
  if (view) draw()
  else void loadView().then(draw)

  // The engine's search keys: Cmd+F, Cmd+G, F3 and Escape. Caught here, on the panel, before they
  // bubble to the editor's Rectangle, so Escape closes find and stops there instead of also taking the
  // reader out of the editor.
  dom.addEventListener('keydown', (event) => {
    if (!runScopeHandlers(editor, event, 'search-panel')) return
    event.preventDefault()
    event.stopPropagation()
  })

  return {
    dom,
    top: false,
    mount: () => {
      mounted = true
      focusField()
    },
    update: (update: ViewUpdate) => {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.startState.readOnly !== update.state.readOnly ||
        getSearchQuery(update.startState) !== getSearchQuery(update.state)
      )
        setCurrent(snapshot(update.state))
    },
    destroy: () => {
      destroyed = true
      if (replaceOpeners.get(editor) === openReplace) replaceOpeners.delete(editor)
      dispose?.()
    },
  }
}

const extension = search({ createPanel: createFindPanel })

/** Open find with the replace row showing and its field focused. A read-only document gets find. */
export function openReplacePanel(editor: EditorView): boolean {
  if (!openSearchPanel(editor)) return false
  replaceOpeners.get(editor)?.()
  return true
}

/** The search panel for a graphical editor. Put it beside `basicSetup`, whose keymap opens it. */
export function editorSearch(): Extension {
  void loadView()
  return extension
}
