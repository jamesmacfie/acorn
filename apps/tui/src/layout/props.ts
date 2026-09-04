import { Align, Display, Edge, FlexDirection, Gutter, Justify, Overflow, Wrap } from 'yoga-layout'
import type { Node as YogaNode } from 'yoga-layout'

// One table from a prop name to the Yoga setter that answers it, and nothing else in the layout pass
// knows a prop name.
//
// The kit hands `<box>` and `<text>` 24 distinct props once `ref`, `title` and the event handlers are
// set aside. 21 of them are Yoga's; the other three are `borderStyle` and `borderColor`, which are
// paint, and `wrapMode`, which is an input to the measure function. `NOT_YOGA` below names every one
// of the rest and why, because a prop that is in neither list is a prop that silently does nothing —
// and `./layout.test.ts` is the check that neither list has fallen behind the kit.
//
// A value the kit does not pass yet still gets a setter where Yoga has one and the cost is a line:
// all four padding and margin edges, `justifyContent`, `maxWidth`, `maxHeight`. An incomplete table
// fails by drawing the wrong layout rather than by erroring, which is the worst way for a table to
// fail, and generating the edges from one loop is cheaper than the bug.

type Setter = (yoga: YogaNode, value: unknown) => void

/** A width, a height or a flex basis: cells, a percentage, or `auto`. */
const dimension = (value: unknown): number | 'auto' | `${number}%` | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (value === 'auto') return 'auto'
  if (typeof value === 'string' && value.endsWith('%')) return value as `${number}%`
  return undefined
}

/** The same, for the setters Yoga gives no `auto` to: the minimums, the maximums, padding and gap. */
const extent = (value: unknown): number | `${number}%` | undefined => {
  const width = dimension(value)
  return width === 'auto' ? undefined : width
}

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const EDGES = { left: Edge.Left, top: Edge.Top, right: Edge.Right, bottom: Edge.Bottom } as const

const FLEX_DIRECTIONS: Record<string, FlexDirection> = {
  row: FlexDirection.Row,
  column: FlexDirection.Column,
  'row-reverse': FlexDirection.RowReverse,
  'column-reverse': FlexDirection.ColumnReverse,
}

const ALIGNMENTS: Record<string, Align> = {
  'flex-start': Align.FlexStart,
  center: Align.Center,
  'flex-end': Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
}

const JUSTIFICATIONS: Record<string, Justify> = {
  'flex-start': Justify.FlexStart,
  center: Justify.Center,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
}

const WRAPS: Record<string, Wrap> = {
  nowrap: Wrap.NoWrap,
  wrap: Wrap.Wrap,
  'wrap-reverse': Wrap.WrapReverse,
}

const OVERFLOWS: Record<string, Overflow> = {
  visible: Overflow.Visible,
  hidden: Overflow.Hidden,
  scroll: Overflow.Scroll,
}

/**
 * What `flexShrink` is where nobody said, and the three props that decide it.
 *
 * Yoga starts a node at 0 and every renderable in the old painter derived it, so we derive it the
 * same way: a box given a width or a height in cells does not shrink, and everything else does. That
 * is what the old painter's `Renderable.setupYogaProperties` did, and the kit is written against it —
 * which is why 153 of its boxes say `flexShrink={0}` out loud and none says 1. A percentage is not a
 * number here, deliberately: the old painter asked `typeof width === 'number'` too.
 *
 * The difference shows up wherever the children of a row want more room than the row has: at 0 they
 * all keep their full size and the last of them is clipped, at 1 they give the overflow up between
 * them. A `TableRow`'s caret marker was clipped outside its panel, and both halves of a `Sections`
 * strip took the whole row each, because a viewport's content box is 100% wide and hands its half
 * that as a floor to grow from (../kit/scrolling.tsx § ownViewport).
 *
 * A blanket 1 also passes every test in this package. The derived rule is here anyway, because it is
 * the answer the kit was written against rather than the answer that happens to be green: the two
 * differ on a fixed-size box inside an overflowing row, which is a shape nothing here draws.
 */
export function flexShrinkFor(props: Record<string, unknown>): number {
  const said = props.flexShrink
  if (typeof said === 'number' && Number.isFinite(said)) return said
  return typeof props.width === 'number' || typeof props.height === 'number' ? 0 : 1
}

/** The props `flexShrinkFor` reads, so a write to any of them re-derives it. */
export const SHRINK_DEPENDS: ReadonlySet<string> = new Set(['flexShrink', 'width', 'height'])

export const SETTERS: Record<string, Setter> = {
  flexDirection: (yoga, value) => yoga.setFlexDirection(FLEX_DIRECTIONS[String(value)] ?? FlexDirection.Column),
  flexGrow: (yoga, value) => yoga.setFlexGrow(number(value)),
  flexShrink: (yoga, value) => yoga.setFlexShrink(number(value)),
  flexBasis: (yoga, value) => yoga.setFlexBasis(dimension(value)),
  flexWrap: (yoga, value) => yoga.setFlexWrap(WRAPS[String(value)] ?? Wrap.NoWrap),
  alignItems: (yoga, value) => yoga.setAlignItems(ALIGNMENTS[String(value)] ?? Align.Stretch),
  alignSelf: (yoga, value) => yoga.setAlignSelf(ALIGNMENTS[String(value)] ?? Align.Auto),
  justifyContent: (yoga, value) => yoga.setJustifyContent(JUSTIFICATIONS[String(value)] ?? Justify.FlexStart),
  overflow: (yoga, value) => yoga.setOverflow(OVERFLOWS[String(value)] ?? Overflow.Visible),
  // `rowGap` and `columnGap` are the same setter with a different gutter, not setters of their own.
  gap: (yoga, value) => void yoga.setGap(Gutter.All, extent(value)),
  rowGap: (yoga, value) => void yoga.setGap(Gutter.Row, extent(value)),
  columnGap: (yoga, value) => void yoga.setGap(Gutter.Column, extent(value)),
  width: (yoga, value) => yoga.setWidth(dimension(value)),
  height: (yoga, value) => yoga.setHeight(dimension(value)),
  minWidth: (yoga, value) => yoga.setMinWidth(extent(value)),
  minHeight: (yoga, value) => yoga.setMinHeight(extent(value)),
  maxWidth: (yoga, value) => yoga.setMaxWidth(extent(value)),
  maxHeight: (yoga, value) => yoga.setMaxHeight(extent(value)),
  padding: (yoga, value) => yoga.setPadding(Edge.All, extent(value)),
  margin: (yoga, value) => yoga.setMargin(Edge.All, dimension(value)),
  // A border costs a cell of layout on the sides it draws, so it is Yoga's business as well as
  // paint's. `true` is every side, which is what `boxBorder` returns; an array is the sides a `Rule`
  // asks for, and it is how one edge of a box becomes a divider between two regions.
  border: (yoga, value) => {
    // Every edge by name rather than `Edge.All`, because a per-edge width beats the `All` one and
    // outlives it: a box that went from `['left']` to `false` kept charging for the divider cell.
    for (const edge of Object.values(EDGES)) yoga.setBorder(edge, value === true ? 1 : 0)
    if (!Array.isArray(value)) return
    for (const side of value as unknown[]) {
      const edge = EDGES[String(side) as keyof typeof EDGES]
      if (edge !== undefined) yoga.setBorder(edge, 1)
    }
  },
  // A hidden subtree costs no layout and no paint. Paint skips `visible === false` for itself, so the
  // two agree without a rule between them.
  visible: (yoga, value) => yoga.setDisplay(value === false ? Display.None : Display.Flex),
}

for (const [side, edge] of Object.entries(EDGES)) {
  const Side = `${side[0]!.toUpperCase()}${side.slice(1)}`
  SETTERS[`padding${Side}`] = (yoga, value) => yoga.setPadding(edge, extent(value))
  SETTERS[`margin${Side}`] = (yoga, value) => yoga.setMargin(edge, dimension(value))
}

/** Every prop the kit passes an intrinsic that is deliberately not Yoga's, with the reason. A prop in
 *  neither this list nor `SETTERS` is a prop that does nothing, and `./layout.test.ts` fails on it. */
export const NOT_YOGA: Readonly<Record<string, string>> = {
  ref: 'the node itself, handed to the caller',
  title: 'a caption paint draws into the top border',
  titleAlignment: 'where paint draws that caption',
  borderStyle: 'which characters paint draws the border with',
  borderColor: 'what colour paint draws it in',
  backgroundColor: 'the cells behind a box\'s content, filled by paint (../paint/paint.ts)',
  wrapMode: 'an input to the measure function (./measure.ts)',
  style: 'a run\'s colour and attributes, read by paint',
  fg: 'a run\'s foreground, read by paint',
  attributes: 'a run\'s bold, dim, underline and inverse bits, read by paint',
  // The same four bits again, one prop each. `../kit/roles.ts § textStyle` answers both ways because
  // a `span` under the old painter reads its weight out of a `style` object and ignores a mask, and a
  // spread of that answer onto a `text` therefore carries these too. Paint reads the mask; phase 4
  // drops the four (../kit/cells.tsx § Run).
  bold: 'a run\'s weight, said as a boolean for a span',
  dim: 'a run\'s dimness, said as a boolean for a span',
  underline: 'a run\'s underline, said as a boolean for a span',
  inverse: 'a run\'s inversion, said as a boolean for a span',
  transform: 'the role\'s own change to the characters, already applied by `styled`',
  textColor: 'a widget\'s foreground, read by paint',
  placeholder: 'a field\'s empty-state text, read by paint (../paint/paint.ts § drawField)',
  placeholderColor: 'what colour paint draws that in, which is the kit\'s slot rather than a hex',
  value: 'a field\'s content, written by the component that owns the model (../kit/asking.tsx)',
  cursor: 'where the caret is in that content, as an offset into it',
  assoc: 'which side of a soft break the caret is on, which decides the row paint draws it at',
  scroll: 'cells an input has slid left, or rows a textarea has slid up; one number, one meaning per kind',
  initialValue: 'the old painter\'s way of seeding a textarea; ours writes `value`',
  offset: 'how many rows a viewport has scrolled, applied by the read-back (./pass.ts)',
  contentOptions: 'the props the old painter\'s scrollbox puts on its own content box; ours draws one',
  scrollX: 'which axis the old painter\'s scrollbox owns; ours is vertical, and one offset says so',
  scrollY: 'the same',
  virtual: 'whether a scrollbox windows its rows, which is the virtualiser\'s question and not Yoga\'s',
  focused: 'the region store owns focus; paint reads it (../keys/regions.ts)',
  terminal: 'the headless emulator a `pty` rectangle holds, by reference, so paint can copy its cells',
}

/** Apply one prop to one Yoga node, if it is one Yoga has an opinion about. */
export function applyProp(yoga: YogaNode, name: string, value: unknown): void {
  SETTERS[name]?.(yoga, value)
}
