/** @jsxImportSource @acorn/tui/jsx */
import { Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import type { Size, Tone } from '@acorn/client-core/kit/tokens'
import { stop } from '../../keys/stops'
import { flatten, Line, slot } from '../cells'
import { iconGlyph, spinnerGlyph } from '../glyphs'
import { litControl, spaceCells } from '../roles'
import { spinnerFrame } from '../tick'

/** `[text]` in the tone's colour. */
export function Badge(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  shape?: 'tag' | 'pill'
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  /** A hover tip: this host has no hover, so it draws nothing. */
  tip?: string
  children: JSX.Element
}) {
  return <Line tone={props.tone}>{`[${flatten(props.children)}]`}</Line>
}

/** `(text)`, with a trailing `✕` when removable. */
export function Chip(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  color?: string
  onRemove?: () => void
  onPress?: () => void
  leading?: JSX.Element
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  reveal?: boolean
  selected?: boolean
  title?: string
  children: JSX.Element
}) {
  // `conditional`, as the table says: a chip with neither handler is text, and takes no place in the
  // cycle. `activate` presses it and `delete` removes it, which is the split the `✕` already drew.
  const control = stop({
    ...(props.onPress ? { onPress: () => props.onPress!() } : {}),
    ...(props.onRemove ? { on: { delete: () => { props.onRemove!(); return true } } } : {}),
  })
  const acts = () => !!props.onPress || !!props.onRemove
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      ref={(element: Renderable) => { if (acts()) control.ref(element) }}
    >
      {slot(props.leading)}
      <Line {...litControl({ focused: control.focused(), strong: props.selected, tone: props.tone })}>
        {`(${flatten(props.children)}${props.onRemove ? ' ✕' : ''})`}
      </Line>
    </box>
  )
}

export function ChipRow(props: { ariaLabel?: string; children: JSX.Element }) {
  return <box flexDirection="row" flexWrap="wrap" gap={spaceCells('inline')}>{props.children}</box>
}

/** `●` in the tone's colour, `○` for neutral. `pulse` is a state, not a motion: a terminal that has
 *  to redraw a cell ten times a second to say "starting" is spending a frame on a full stop. */
export function StatusDot(props: {
  tone: Extract<Tone, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'>
  mixed?: boolean
  pulse?: boolean
  label?: string
  /** A hover tip: this host has no hover, so it draws nothing. */
  tip?: string
  size?: Extract<Size, 'sm' | 'md'>
}) {
  return <Line tone={props.tone}>{props.mixed ? '◐' : props.tone === 'muted' ? '○' : '●'}</Line>
}

/** Initials in brackets; no image. Two letters, because a login is a word and a terminal column is
 *  not a circle. */
export function UserAvatar(props: { login: string | null | undefined; size?: 'sm' | 'md' }) {
  const initials = () => {
    const login = props.login?.trim() ?? ''
    if (!login) return '··'
    const parts = login.split(/[^a-zA-Z0-9]+/).filter(Boolean)
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : login.slice(0, 2)).toUpperCase()
  }
  return <Line role="muted">{`[${initials()}]`}</Line>
}

/** A shared icon name rendered as one cell. The host resolves its shape; callers keep their domain
 * state, tone and title in the same shared component they use on desktop. */
export function Icon(props: { name: string; size?: number | string; title?: string; tone?: Tone | 'brand'; spin?: boolean }) {
  const glyph = () => iconGlyph(props.name)
  return (
    <Show when={glyph()}>
      <Line tone={props.tone === 'brand' ? 'accent' : props.tone}>
        {props.spin ? spinnerGlyph(spinnerFrame()) : glyph()}
      </Line>
    </Show>
  )
}

/** `⌘K` or `ctrl+k`, per host. The chord arrives already spelled for this platform; the node is the
 *  box around it, and a terminal has no box. */
export function Kbd(props: { size?: Extract<Size, 'xs' | 'sm'>; children: JSX.Element }) {
  return <Line role="strong">{flatten(props.children)}</Line>
}

/** reduced: a braille cycle, on the shell's one tick (../tick.ts). One timer for the whole screen
 *  rather than one per spinner, which is the same thing the DOM gets for free by putting the
 *  animation in CSS. Before the shell starts the tick this is frame zero and stays there. */
export function Spinner(_props: { size?: 'sm' | 'md'; label?: string }) {
  return <Line role="muted">{spinnerGlyph(spinnerFrame())}</Line>
}
