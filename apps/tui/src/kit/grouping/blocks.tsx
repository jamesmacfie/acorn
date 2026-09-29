/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import type { Size, Space, Tone } from '@acorn/client-core/kit/tokens'
import { isCompact, slotColor } from '../../appearance'
import { Line, slot } from '../cells'
import { borderCell, boxBorder, litControl, spaceCells, spaceLines } from '../roles'
import { stop } from '../../keys/stops'

export function Stack(props: { gap?: Space; grow?: boolean; children: JSX.Element }) {
  // `grow`: the stack is the region and takes what is left of it, so a scroller or a canvas inside
  // it has a height to work against. Still `flexShrink={0}`, by the rule above: what does not fit
  // is clipped by the region, never squeezed into the line above.
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      flexGrow={props.grow ? 1 : 0}
      gap={spaceLines(props.gap ?? 'stack')}
    >
      {props.children}
    </box>
  )
}

export function Inline(props: { gap?: Space; wrap?: boolean; spread?: boolean; children: JSX.Element }) {
  return (
    <box
      flexDirection="row"
      flexWrap={props.wrap ? 'wrap' : 'nowrap'}
      justifyContent={props.spread ? 'space-between' : undefined}
      gap={spaceCells(props.gap ?? 'inline')}
    >
      {props.children}
    </box>
  )
}

export function Section(props: { label: string; count?: number; actions?: JSX.Element; sticky?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexShrink={0} marginTop={spaceLines('section')}>
      <box flexDirection="row" gap={1}>
        <Line role="eyebrow">{props.label}</Line>
        <Show when={props.count !== undefined}><Line role="muted">{String(props.count)}</Line></Show>
        {slot(props.actions)}
      </box>
      {props.children}
    </box>
  )
}

/** `▸ label` closed, `▾ label` open, children indented two cells. Uncontrolled state is the kit's,
 *  the same rule the DOM fold keeps; `persistKey` has nowhere to persist to yet and is ignored. */
export function Fold(props: {
  label: string
  count?: number
  meta?: JSX.Element
  actions?: JSX.Element
  level?: 'pane' | 'group' | 'sub'
  contentIndent?: 'default' | 'none'
  /** Inset the fold behind a left rule, matching the DOM host's ownership cue. */
  nested?: boolean
  persistKey?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: JSX.Element
}) {
  const [local, setLocal] = createSignal(props.defaultOpen ?? false)
  const open = () => (props.onOpenChange ? props.open ?? false : local())
  const toggle = () => {
    const next = !open()
    setLocal(next)
    props.onOpenChange?.(next)
  }
  // The header row is the stop, and the children stay after it as siblings, so reading order runs
  // header then contents: `↓` from an open fold's header enters its first child.
  const control = stop({ onPress: toggle })
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      border={props.nested ? ['left'] : []}
      borderStyle="single"
      borderColor={props.nested ? slotColor('default') : undefined}
      paddingLeft={props.nested ? 1 : 0}
    >
      <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
        <Line {...litControl({ focused: control.focused() })}>{open() ? '▾' : '▸'}</Line>
        <Line {...litControl({ focused: control.focused(), strong: true })}>{props.label}</Line>
        <Show when={props.count !== undefined}><Line role="muted">{String(props.count)}</Line></Show>
        {slot(props.meta)}
        {slot(props.actions)}
      </box>
      <Show when={open()}>
        <box flexDirection="column" paddingLeft={props.contentIndent === 'none' ? 0 : 2}>{props.children}</box>
      </Show>
    </box>
  )
}

/** A box-drawing frame whose left edge carries the stripe tone for the full height of the card. */
export function Card(props: {
  interactive?: boolean
  selected?: boolean
  stripe?: Extract<Tone, 'accent' | 'ok' | 'warn' | 'danger'>
  pad?: Extract<Size, 'sm' | 'md'>
  /** Sized by what is inside it rather than by the room it is given. Here that is the frame taking
   *  its width from its widest line instead of the column's. */
  fit?: boolean
  disabled?: boolean
  onPress?: () => void
  title?: string
  focus?: boolean
  children: JSX.Element
}) {
  const control = stop({
    onPress: () => props.onPress?.(),
    disabled: () => !!props.disabled,
  })
  // Focus colours the frame and takes precedence over the card's tone. In compact density a toned
  // card keeps only its left edge, so the speaker cue still spans the whole message.
  const lit = () => control.focused()
  const accent = () => lit() ? 'accent' : props.stripe
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      minWidth={0}
      width={props.fit ? undefined : '100%'}
      alignSelf={props.fit ? 'flex-start' : undefined}
      marginTop={isCompact() ? 0 : 1}
      marginBottom={isCompact() ? 0 : 1}
      ref={(element: Renderable) => { if (props.onPress) control.ref(element) }}
      {...(isCompact()
        ? { border: accent() ? ['left'] as const : false, borderStyle: 'single' as const }
        : boxBorder('surface', lit() ? { tone: 'accent' } : {}))}
      borderLeftAccent={accent() ? { glyph: borderCell('stripe').glyph, color: slotColor(accent()!) } : undefined}
      title={props.title}
      paddingLeft={isCompact() ? 0 : 1}
      paddingRight={isCompact() ? 0 : 1}
    >
      {props.children}
    </box>
  )
}
/** A bar of controls.
 *
 *  It wraps rather than clips. A bar is written for a window and drawn here in a pane column — the
 *  agents pane header is four controls and a title in about fifty cells — and a row that shrinks its
 *  children cuts their labels to `[Sessio` and `[ Ne`, which names nothing. Yoga moves what does not
 *  fit onto the next line before it shrinks anything, so an overfull bar costs a line instead of its
 *  words, and a bar that fits is laid out exactly as it was.
 *
 *  The gap is the column gap alone. Yoga's `gap` sets both axes, so a wrapped bar gained a blank row
 *  between its lines.
 *
 *  Nothing here wraps `props.children`. A context provider around them would put them inside a memo
 *  of Solid's own, and re-running a toolbar's children as a unit used to break the changes pane: a
 *  callback-form `<Show>` in that bar had its accessor read again after its condition went false,
 *  which stock Solid refuses as `Stale read from <Show>`. Our copy holds the last value instead
 *  (patches/README.md), but the bar still has no reason to re-run its children. An open panel widens
 *  itself instead (§ `Menu`). */
export function Toolbar(props: { variant?: 'bar' | 'actions'; size?: 'sm' | 'md'; ariaLabel?: string; children: JSX.Element }) {
  return <box flexDirection="row" flexWrap="wrap" columnGap={spaceCells('inline')}>{props.children}</box>
}

/** `flexGrow` on an empty box is what "push what follows to the far end" is in a cell layout. */
export const ToolbarSpacer = () => <box flexGrow={1} />
Toolbar.Spacer = ToolbarSpacer
Toolbar.Group = (props: { children: JSX.Element }) => <box flexDirection="row">{props.children}</box>
