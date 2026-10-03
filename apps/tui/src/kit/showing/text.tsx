/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show, type JSX } from 'solid-js'
import type { TextRole, Tone } from '@acorn/client-core/kit/tokens'
import type { HeadingProps } from '@acorn/client-core/kit/components/content'
import { flatten, Line, runStyle } from '../cells'
import { borderCell } from '../roles'
import { stop } from '../../keys/stops'

// The terminal form of these kit nodes follows docs/ui-design/every-node.md § Every node at 80 by 24.

export function Text(props: { emphasis?: TextRole; tone?: Tone; wrap?: boolean; tip?: string; tipAt?: number; children: JSX.Element }) {
  return <Line role={props.emphasis} tone={props.tone} wrap={props.wrap}>{props.children}</Line>
}

/** The text, underlined, pressable. Underline is the `control` border role's answer, which is what a
 *  link is: a run of text with an edge under it. */
export function Link(props: { href?: string; onPress?: () => void; tip?: string; children: JSX.Element }) {
  // A link with a handler presses it. A link with only an `href` prints the URL on the line below,
  // which is what this host already does with anything it cannot open for you (../copy.ts) —
  // there is no browser to hand it to and a terminal's own OSC 8 support is not something to guess at.
  const [shown, setShown] = createSignal(false)
  const control = stop({
    onPress: () => {
      if (props.onPress) return props.onPress()
      if (props.href) setShown(true)
    },
  })
  const role = () => (control.focused() ? 'strong' : 'body')
  const style = () => ({
    ...runStyle(role(), 'accent'),
    attributes: (runStyle(role(), 'accent').attributes ?? 0) | borderCell('control').attributes,
  })
  return (
    <box flexDirection="column" flexShrink={0} ref={control.ref}>
      <text {...style()}>{flatten(props.children)}</text>
      <Show when={shown()}><Line role="mono">{props.href!}</Line></Show>
    </box>
  )
}

export function Heading(props: HeadingProps) {
  return (
    <box flexDirection="column">
      <Show when={props.eyebrow}><Line role="eyebrow">{props.eyebrow!}</Line></Show>
      <Line role="heading">{props.children}</Line>
      <Show when={props.help}><Line role="muted" wrap>{props.help!}</Line></Show>
    </box>
  )
}
