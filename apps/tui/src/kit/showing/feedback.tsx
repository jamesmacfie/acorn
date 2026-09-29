/** @jsxImportSource @acorn/tui/jsx */
import { Show, type JSX } from 'solid-js'
import type { Size, Tone } from '@acorn/client-core/kit/tokens'
import { flatten, Line, slot } from '../cells'

/** One line prefixed with the tone's glyph. */
export function Alert(props: {
  tone?: Tone
  variant?: 'inline' | 'banner'
  title?: string
  actions?: JSX.Element
  onDismiss?: () => void
  children: JSX.Element
}) {
  const tone = () => props.tone ?? 'danger'
  const glyph = () => (tone() === 'ok' ? '✓' : tone() === 'warn' ? '!' : tone() === 'accent' ? 'i' : '✕')
  return (
    <box flexDirection="row" gap={1}>
      <Line role="strong" tone={tone()}>{glyph()}</Line>
      <Show when={props.title}><Line role="strong" tone={tone()}>{props.title!}</Line></Show>
      <Line tone={tone()} wrap>{props.children}</Line>
      {slot(props.actions)}
    </box>
  )
}

/** Centred dim text. Centred by padding rather than by measuring: a pane that has room for an empty
 *  state has room for two cells of it. */
export function EmptyState(props: {
  icon?: JSX.Element
  title?: string
  action?: JSX.Element
  busy?: boolean
  align?: 'center' | 'start'
  size?: Size
  children?: JSX.Element
}) {
  return (
    <box flexDirection="column" paddingTop={1} paddingLeft={2}>
      <Show when={props.title}><Line role="strong">{props.title!}</Line></Show>
      <Line role="muted" wrap>{props.busy ? 'loading…' : flatten(props.children)}</Line>
      {slot(props.action)}
    </box>
  )
}
