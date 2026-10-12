// Other plugins' marks on the cursor line, drawn as muted text after the line's end, with their detail
// in a tooltip (docs/editor/line-annotations.md). The controller decides when to ask and hands the
// answer in through `lineAnnotationEffect`. This file only draws it.
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { richTooltipDom, richTooltipTheme, type RichTooltipContent } from '@acorn/plugin-api/ui/editor'

/** One contributor's mark, with the host's credit already resolved. */
export type LineAnnotationMark = { text: string; detail?: RichTooltipContent; credit: string }

/** The marks for one one-based line, or null to clear. */
export type LineAnnotation = { line: number; marks: readonly LineAnnotationMark[] }

type Shown = { pos: number; marks: readonly LineAnnotationMark[]; tooltip: Tooltip | null }

/** How long the pointer rests on the label before the tooltip opens, matching CodeMirror's hover. */
const OPEN_DELAY_MS = 300
/** How long the tooltip stays after the pointer leaves, so it can cross the gap into the tooltip. */
const CLOSE_DELAY_MS = 200

const setAnnotation = StateEffect.define<LineAnnotation | null>()
const setTooltipOpen = StateEffect.define<boolean>()

const tooltipFor = (pos: number, marks: readonly LineAnnotationMark[]): Tooltip => ({
  pos,
  above: true,
  create: (view) => {
    const dom = document.createElement('div')
    for (const mark of marks) dom.append(richTooltipDom(mark.detail ?? mark.text, mark.credit))
    // The pointer moving from the label into the tooltip keeps it open, so its text can be selected.
    dom.addEventListener('mouseenter', () => hoverControl(view)?.enter())
    dom.addEventListener('mouseleave', () => hoverControl(view)?.leave())
    return { dom }
  },
})

const shownField = StateField.define<Shown | null>({
  create: () => null,
  update: (shown, transaction) => {
    // An edit or a cursor move hides the label at once. The controller asks again once the cursor
    // settles on a saved document.
    let next = transaction.docChanged || transaction.selection ? null : shown
    for (const effect of transaction.effects) {
      if (effect.is(setAnnotation)) {
        const value = effect.value
        next =
          value && value.marks.length && value.line <= transaction.state.doc.lines
            ? { pos: transaction.state.doc.line(value.line).to, marks: value.marks, tooltip: null }
            : null
      } else if (effect.is(setTooltipOpen) && next) {
        next = { ...next, tooltip: effect.value ? (next.tooltip ?? tooltipFor(next.pos, next.marks)) : null }
      }
    }
    return next
  },
  provide: (field) => [
    EditorView.decorations.from(field, (shown) =>
      shown
        ? Decoration.set(Decoration.widget({ widget: new LabelWidget(shown.marks), side: 1 }).range(shown.pos))
        : Decoration.none,
    ),
    showTooltip.from(field, (shown) => shown?.tooltip ?? null),
  ],
})

/** Opens and closes the tooltip from pointer enter and leave on the label and the tooltip, rather than
 *  `hoverTooltip` on text positions, so it never competes with language hover over the code. */
class HoverControl {
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly view: EditorView) {}

  enter() {
    clearTimeout(this.timer)
    if (this.view.state.field(shownField)?.tooltip) return
    this.timer = setTimeout(() => this.view.dispatch({ effects: setTooltipOpen.of(true) }), OPEN_DELAY_MS)
  }

  leave() {
    clearTimeout(this.timer)
    if (!this.view.state.field(shownField)?.tooltip) return
    this.timer = setTimeout(() => this.view.dispatch({ effects: setTooltipOpen.of(false) }), CLOSE_DELAY_MS)
  }

  destroy() {
    clearTimeout(this.timer)
  }
}

const hoverPlugin = ViewPlugin.fromClass(HoverControl)
const hoverControl = (view: EditorView): HoverControl | null => view.plugin(hoverPlugin)

class LabelWidget extends WidgetType {
  constructor(private readonly marks: readonly LineAnnotationMark[]) {
    super()
  }

  override eq(other: LabelWidget): boolean {
    return other.marks === this.marks
  }

  // A widget isn't part of the document, so the cursor can't land in it and copying skips it.
  override toDOM(view: EditorView): HTMLElement {
    const label = document.createElement('span')
    label.className = 'cm-line-annotation'
    label.textContent = this.marks.map((mark) => mark.text).join(' · ')
    label.addEventListener('mouseenter', () => hoverControl(view)?.enter())
    label.addEventListener('mouseleave', () => hoverControl(view)?.leave())
    return label
  }
}

const closeOnEscape = keymap.of([
  {
    key: 'Escape',
    run: (view) => {
      if (!view.state.field(shownField, false)?.tooltip) return false
      view.dispatch({ effects: setTooltipOpen.of(false) })
      return true
    },
  },
])

const theme = EditorView.baseTheme({
  '.cm-line-annotation': {
    marginLeft: '2.5em',
    color: 'var(--text-faint)',
    userSelect: 'none',
    cursor: 'default',
  },
})

export const lineAnnotationExtension = (): Extension => [
  shownField,
  hoverPlugin,
  closeOnEscape,
  theme,
  richTooltipTheme,
]

export const lineAnnotationEffect = (annotation: LineAnnotation | null): StateEffect<LineAnnotation | null> =>
  setAnnotation.of(annotation)

/** Open the tooltip at the cursor line's label, for a keyboard user. False when no label is shown. */
export function showLineAnnotationDetails(view: EditorView): boolean {
  if (!view.state.field(shownField, false)) return false
  view.dispatch({ effects: setTooltipOpen.of(true) })
  return true
}
