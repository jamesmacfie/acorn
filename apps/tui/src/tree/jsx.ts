import type { JSX as SolidJSX } from 'solid-js'
import type { Color } from '../colour'
import type { Renderable } from './compat'
import type { Wheel } from './hit'

// What the intrinsics take, for tsc's benefit.
//
// The transform does not read this — with `generate: 'universal'` it emits calls to the module named
// in `../../vite.config.ts` and never touches a jsx-runtime — so this file's whole job is to make a
// wrong prop a compile error. Which means it should say what the kit actually passes rather than
// everything Yoga could take: a prop with no setter in `../layout/props.ts` and no line in its
// `NOT_YOGA` list is a prop that silently does nothing, and being refused here is how the author
// finds out.
//
// The colour props take `../colour.ts`'s three answers and nothing else: the terminal's own colour,
// one of its sixteen slots, or a 24-bit triple. This module does not decide what a colour is, it just
// says which type carries one.

/** Cells, a percentage of the parent, or whatever the content asks for. */
type Extent = number | `${number}%` | 'auto'

type Ref<T> = T | ((node: T) => void)

/** The flex props, which is every prop with a Yoga setter behind it. */
export type FlexProps = {
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexGrow?: number
  flexShrink?: number
  flexBasis?: Extent
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline'
  alignSelf?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline'
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'
  overflow?: 'visible' | 'hidden' | 'scroll'
  gap?: number
  rowGap?: number
  columnGap?: number
  width?: Extent
  height?: Extent
  minWidth?: Extent
  minHeight?: Extent
  maxWidth?: Extent
  maxHeight?: Extent
  padding?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  margin?: number
  marginLeft?: number
  marginRight?: number
  marginTop?: number
  marginBottom?: number
  /** `false` is `DISPLAY_NONE`, so a hidden subtree costs no layout and no paint. */
  visible?: boolean
}

/** A wheel event over a box, as `./hit.ts § wheelAt` delivers one. The later slice that wires the
 *  input parser's mouse events to the same walk changes where it comes from and not its shape. */
type Scroll = Wheel

export type BoxProps = FlexProps & {
  ref?: Ref<Renderable>
  /** `true` is every side; an array is the sides a `Rule` asks for. Costs a cell of layout where it
   *  draws, which is why it is Yoga's business as well as paint's. */
  border?: boolean | readonly ('top' | 'right' | 'bottom' | 'left')[]
  borderStyle?: 'single'
  borderColor?: Color
  /** Cells behind the content. Nothing in the kit asks for one — a terminal has no surface to paint
   *  and a role that wanted one would say `inverse` instead — but paint fills it where it is given,
   *  because a run drawn over it keeps it and that is what a highlighted row would need. */
  backgroundColor?: Color
  /** A caption paint draws into the top border. */
  title?: string
  titleAlignment?: 'left' | 'center' | 'right'
  onSizeChange?: () => void
  onMouseScroll?: (event: Scroll) => void
  children?: SolidJSX.Element
}

/** A run of text. `wrapMode` is an input to the measure function rather than a Yoga style. */
export type TextProps = FlexProps & {
  ref?: Ref<Renderable>
  wrapMode?: 'word' | 'none'
  fg?: Color
  /** The bold, dim, underline and inverse bits as one mask, which is what `../kit/roles.ts` computes. */
  attributes?: number
  /** The role's own change to the characters, already applied by `styled`. Carried so a spread of a
   *  whole style object type-checks; paint ignores it. */
  transform?: (value: string) => string
  children?: SolidJSX.Element
}

/** A styled stretch inside one `text`. Takes the same props a `text` does, because it is the same
 *  thing at a different size — which is the `spanStyle` special case made unnecessary. */
export type SpanProps = TextProps

export type ScrollBoxProps = FlexProps & {
  ref?: Ref<Renderable>
  /** How many rows the viewport has scrolled its content by. The component owns the number and this
   *  is where paint and the read-back read it (../kit/scrolling.tsx, ../layout/pass.ts). */
  offset?: number
  scrollX?: number
  scrollY?: number
  /** Whether the box windows its rows to what fits. */
  virtual?: boolean
  /** The props the box puts on its own content node. */
  contentOptions?: FlexProps
  children?: SolidJSX.Element
}

/** The two editable widgets and the PTY rectangle, whose content props phase 3 owns. To layout they
 *  are boxes, which is all this slice needs them to be. */
export type InputProps = FlexProps & {
  ref?: Ref<Renderable>
  value?: string
  placeholder?: string
  textColor?: Color
  focused?: boolean
  onInput?: (value: string) => void
  onSubmit?: (value: string) => void
}

export type TextareaProps = FlexProps & {
  ref?: Ref<Renderable>
  initialValue?: string
  placeholder?: string
  textColor?: Color
  focused?: boolean
  onContentChange?: (value: string) => void
}

export type PtyProps = FlexProps & { ref?: Ref<Renderable> }

export namespace JSX {
  export type Element = SolidJSX.Element

  export interface IntrinsicElements {
    box: BoxProps
    text: TextProps
    span: SpanProps
    scrollbox: ScrollBoxProps
    input: InputProps
    textarea: TextareaProps
    pty: PtyProps
  }

  export interface ElementChildrenAttribute {
    children: {}
  }
}
