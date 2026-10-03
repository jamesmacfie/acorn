import { children, Show, type JSX } from 'solid-js'
import type { Size, Tone } from '../../tokens/tokens'
import Icon from '../content/Icon'

/* Chip: Badge's interactive sibling. See docs/ui-design/kit-internals.md § How the kit is built
   (Badge / Chip) for when to use which, and for `data-colored`.

   The element switches on interactivity: `onPress` renders a <button>, otherwise a <span> whose
   x is its own small button. */
export function Chip(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  /** A provider's own colour, from an API response — a Linear label, a GitHub label. Third-party
   *  identity rather than a design decision, which is why it is the one colour a node accepts. */
  color?: string
  onRemove?: () => void
  onPress?: () => void
  leading?: JSX.Element
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  /** Hide the × until the chip is hovered or focused, as github's label rows do. */
  reveal?: boolean
  /** Picked out of a set, the way a filter chip is. Selection is a state, not a class. */
  selected?: boolean
  title?: string
  children: JSX.Element
}) {
  const attrs = () => ({
    class: 'ui-chip',
    'data-tone': props.tone ?? 'neutral',
    'data-selected': props.selected ? '' : undefined,
    'data-size': props.size ?? 'sm',
    'data-dashed': props.dashed ? '' : undefined,
    'data-reveal': props.reveal ? '' : undefined,
    'data-colored': props.color ? '' : undefined,
    'data-tip': props.title,
    // A custom property is the only way to hand a runtime value to a stylesheet. Sanitised because
    // the colour comes off an API response: anything but a plain colour token is dropped.
    style: props.color && SAFE_COLOR.test(props.color) ? { '--chip-color': props.color } : undefined,
  })
  // Read once, for the reason on RowParts.
  const leading = children(() => props.leading)
  const body = (
    <>
      <Show when={leading()}><span class="ui-chip-leading">{leading()}</span></Show>
      <span class="ui-chip-label">{props.children}</span>
    </>
  )
  return (
    <Show
      when={props.onPress}
      fallback={
        <span {...attrs()}>
          {body}
          <Show when={props.onRemove}>
            {/* A mark inside the chip's own button, not an IconButton, whose square would make the chip
                taller than the text it sits beside. */}
            <button type="button" class="ui-chip-remove" aria-label="Remove" onClick={() => props.onRemove?.()}><Icon name="x" /></button>
          </Show>
        </span>
      }
    >
      <button type="button" {...attrs()} onClick={() => props.onPress?.()}>{body}</button>
    </Show>
  )
}

// #rgb/#rrggbb/#rrggbbaa, rgb()/rgba()/hsl()/hsla(), or a bare CSS ident. Enough for every provider
// colour in the codebase and nothing that can close a style attribute.
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/]+\)|[a-zA-Z-]+)$/
