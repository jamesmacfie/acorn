/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show } from 'solid-js'
import { Line } from '../cells'
import { copyToTerminal } from '../copy'
import { Button } from './buttons'

/** fallback: the level is `fallback` because a terminal cannot reach the clipboard portably. Where
 *  the terminal advertises OSC 52 the button works and the level is `full` at runtime; where it does
 *  not, the host prints the value on its own line to copy by hand (../copy.ts). */
// `always`, `size`, and `tipSub` are accepted and ignored. On the DOM host they turn off a hover reveal,
// size the box, and add a tip line; a terminal has no hover, no sizes, and no tips, so this copy is
// drawn the same either way and a caller that needs them on the DOM should not have to ask twice.
export function CopyButton(props: {
  text: () => string
  onCopy?: (text: string) => void
  title?: string
  tipSub?: string
  always?: boolean
  size?: 'xs' | 'sm' | 'md'
}) {
  const [shown, setShown] = createSignal(false)
  const copy = () => {
    const text = props.text()
    if (props.onCopy) return props.onCopy(text)
    if (!copyToTerminal(text)) setShown(true)
  }
  return (
    <box flexDirection="column">
      <Button variant="bare" label={props.title ?? 'Copy'} onPress={copy} />
      <Show when={shown()}>
        <Line role="mono">{props.text()}</Line>
      </Show>
    </box>
  )
}
