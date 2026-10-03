import { children, Show, type JSX } from 'solid-js'
import { safeContentHref } from '@acorn/protocol/externalUrl.ts'
import type { ItemProps } from '../../keys/collection'
import { isExternal } from '../content/isExternal'
import Icon from '../content/Icon'

/** Did this click land on a control inside the row rather than on the row itself? A row action's
 *  menu button must not also open the row, and no kit node hands a plugin an event to stop, so the
 *  row works it out. */
const fromNestedControl = (event: MouseEvent): boolean => {
  const target = event.target
  if (!(target instanceof Element)) return false
  const control = target.closest('button, a, input, select, textarea, [role="button"]')
  return control !== null && control !== event.currentTarget
}

/** A virtualizer's absolute placement, as a style. The one place a kit node turns a number into a
 *  pixel, because a virtualizer's geometry has nowhere else to live. */
const placement = (own: { offset?: number; height?: number }): JSX.CSSProperties | undefined =>
  own.offset === undefined && own.height === undefined
    ? undefined
    : {
      ...(own.offset === undefined ? {} : { position: 'absolute' as const, top: '0', left: '0', right: '0', transform: `translateY(${own.offset}px)` }),
      ...(own.height === undefined ? {} : { height: `${own.height}px` }),
    }

/** A row's parts beside its body. Each slot is read once, through `children`: a prop is a getter, and
 *  reading it again runs the caller's JSX again, so a `Show` testing `props.leading` beside an insert
 *  of `props.leading` built every leading mark twice and kept the unused copy alive. A component of its
 *  own so a collapsed row, which draws none of them, builds none of them. */
function RowParts(props: {
  leading?: JSX.Element
  meta?: JSX.Element
  metaFields?: number
  trailing?: JSX.Element
  children: JSX.Element
}) {
  const leading = children(() => props.leading)
  const meta = children(() => props.meta)
  const trailing = children(() => props.trailing)
  return (
    <>
      <Show when={leading()}><span class="ui-row-leading">{leading()}</span></Show>
      <span class="ui-row-body">{props.children}</span>
      <Show when={meta()}><span class="ui-row-meta" data-fields={props.metaFields || undefined}>{meta()}</span></Show>
      <Show when={trailing()}><span class="ui-row-trailing">{trailing()}</span></Show>
    </>
  )
}

/* Row: navigational list rows, including the role/tabindex/Enter/Space wiring an activatable row
   needs.

   Not for the tabular rows (.diff-row, .dbgrid-row, and similar): those are measured geometry
   where a changed box model silently corrupts scroll math. A virtualized list row is fine; github's
   PR list takes its measured height through `style` and opts out of `min-height`. */
export function Row(props: {
  /** The collection's props for this row, from `Rows`. Opaque: the row spreads it and never reads
   *  it. Without it a row is a lone stop, which is what a row outside a `Rows` still is. */
  item?: ItemProps
  /** Number of `.ui-row-field` cells inside `meta`, so the row can reserve a track for each. */
  metaFields?: number
  /** Visually place meta after the leading content and before the title. DOM reading order stays intact. */
  metaFirst?: boolean
  selected?: boolean
  /** Inset the row behind a left rule, so it reads as owned by the row above it. */
  nested?: boolean
  /** Indentation level. Generalises `nested` (which is depth 1) for TreeRow. */
  depth?: number
  /** Hide `trailing` until hover or focus. */
  reveal?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onPress?: () => void
  /** A mouse double-click, for rows where the second press has a distinct conventional meaning. */
  onDoublePress?: () => void
  /** Renders an <a class="ui-row">.
   *
   *  With `onPress` it behaves as the router's <A> does: a plain left-click is intercepted and
   *  routed, while middle-click, cmd-click and "copy link address" fall through to the real href.
   *  Reimplemented rather than imported, because the kit is served to plugin frames, and a
   *  frame is a separate document with no Router above it. */
  href?: string
  /** Absolute placement from a virtualizer, in pixels. A measurement, not a design decision: a
   *  virtualizer computes both and no stylesheet can. See docs/ui-design/closed-kit.md § The closed kit. */
  offset?: number
  height?: number
  /** The accessible name, where the row's own text is not one. */
  label?: string
  /** Pointer or keyboard focus entered or left the row. One callback rather than four handlers,
   *  because every caller does the same thing with all four: start a prefetch, then cancel it. */
  onHover?: (entered: boolean) => void
  /** `stacked` is the multi-line row, such as rollbar's occurrence list. `tree` is what TreeRow
   *  renders; it is here rather than as a class so the kit still owns the markup. */
  variant?: 'default' | 'stacked' | 'tree'
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  /** This row at the width of an icon rail: a glyph, a number, a short identifier. What is left of
   *  the row when there is room for one mark and the name has moved into the tooltip.
   *
   *  Passing it is what collapses the row, so a caller hands it down from the same signal its column
   *  reads (../../lib/layout/collapseState.ts) and the two cannot disagree. Leading, body, meta and trailing
   *  all give way to it, along with depth, nesting and revealed controls, which are about a width
   *  this row no longer has.
   *
   *  It has the row's existing height to work in, never more: a virtualized list takes its row height
   *  from a token read off the document root (../../lib/layout/metrics.ts), so a taller collapsed row is a
   *  height the virtualizer has not accounted for. */
  collapsed?: JSX.Element
  /** `collapsed` as a Lucide name, for a caller that can only send data. A remote tree's props are
   *  JSON, so an `Icon` element cannot cross the wire; a name can. `collapsed` wins when both are set. */
  collapsedIcon?: string
  title?: string
  /** The app's tooltip for the row at full width (docs/ui-design/tooltips.md § Tooltips). A collapsed row's
   *  tip stays its name. `tipAt` adds a relative age under whichever tip is showing. A row with a tip
   *  drops the browser's `title` tooltip, which would otherwise open on top of it. */
  tip?: string
  tipAt?: number
  children: JSX.Element
}) {
  const safeHref = safeContentHref(props.href)
  const activate = () => props.onPress?.()
  // Given a rail form, draw it. The caller owns both the column's collapse and its rows, so it
  // passes the slot or leaves it off; there is no second boolean that could disagree with the width
  // the column is actually at.
  const collapsed = () => props.collapsed !== undefined || props.collapsedIcon !== undefined
  const tipText = () => collapsed() ? (props.title ?? props.label) : props.tip
  const body = (
    <Show
      when={collapsed()}
      fallback={(
        <RowParts leading={props.leading} meta={props.meta} metaFields={props.metaFields} trailing={props.trailing}>
          {props.children}
        </RowParts>
      )}
    >
      <span class="ui-row-collapsed">{props.collapsed ?? <Icon name={props.collapsedIcon!} />}</span>
    </Show>
  )
  if (safeHref) {
    return (
      <a
        {...(props.item ?? {})}
        href={safeHref}
        target={isExternal(safeHref) ? '_blank' : undefined}
        rel={isExternal(safeHref) ? 'noopener noreferrer' : undefined}
        class="ui-row"
        data-selected={props.selected ? '' : undefined}
        data-collapsed={collapsed() ? '' : undefined}
        data-nested={props.nested && !collapsed() ? '' : undefined}
        data-depth={props.depth && !collapsed() ? String(props.depth) : undefined}
        data-reveal={props.reveal && !collapsed() ? '' : undefined}
        data-density={props.density ?? 'default'}
        data-variant={props.variant ?? 'default'}
        data-meta-first={props.metaFirst && !collapsed() ? '' : undefined}
        title={props.tip ? undefined : props.title}
        data-tip={tipText()}
        data-tip-at={tipText() && props.tipAt !== undefined ? props.tipAt : undefined}
        aria-label={props.label}
        aria-selected={props.item ? !!props.selected : undefined}
        style={placement(props)}
        onFocus={() => { props.item?.onFocus(); props.onHover?.(true) }}
        onBlur={() => props.onHover?.(false)}
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
        onClick={(event) => {
          // A control inside the row keeps its click, and the link must not follow its href either.
          if (fromNestedControl(event)) return event.preventDefault()
          if (!props.onPress) return
          // Leave the browser its own answers: a new tab, a new window, a download, or a handler
          // that already claimed the event.
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          activate()
        }}
        onDblClick={(event) => {
          if (!fromNestedControl(event)) props.onDoublePress?.()
        }}
      >
        {body}
      </a>
    )
  }
  // Inside a `Rows` the collection owns the role and the roving tabindex; on its own the row is a
  // lone button-shaped stop, which is what every list was before the kit had a collection node.
  return (
    <div
      {...(props.item ?? {})}
      class="ui-row"
      data-selected={props.selected ? '' : undefined}
      data-collapsed={collapsed() ? '' : undefined}
      data-nested={props.nested && !collapsed() ? '' : undefined}
      data-depth={props.depth && !collapsed() ? String(props.depth) : undefined}
      data-reveal={props.reveal && !collapsed() ? '' : undefined}
      data-density={props.density ?? 'default'}
      data-variant={props.variant ?? 'default'}
      data-meta-first={props.metaFirst && !collapsed() ? '' : undefined}
      title={props.tip ? undefined : props.title}
      data-tip={tipText()}
      data-tip-at={tipText() && props.tipAt !== undefined ? props.tipAt : undefined}
      aria-label={props.label}
      aria-selected={props.item ? !!props.selected : undefined}
      style={placement(props)}
      role={props.item?.role ?? (props.onPress ? 'button' : undefined)}
      tabindex={props.item ? props.item.tabindex : props.onPress ? 0 : undefined}
      onClick={props.onPress ? (event) => { if (!fromNestedControl(event)) activate() } : undefined}
      onDblClick={props.onDoublePress ? (event) => { if (!fromNestedControl(event)) props.onDoublePress?.() } : undefined}
      onKeyDown={props.onPress && !props.item
        ? (event) => {
          // Only when the row itself has focus; a button nested inside owns its own keys. Inside a
          // collection this is the `activate` intent instead, so the row does not answer twice.
          if (event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          activate()
        }
        : undefined}
    >
      {body}
    </div>
  )
}
