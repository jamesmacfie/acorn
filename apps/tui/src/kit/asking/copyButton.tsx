/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show } from 'solid-js'
import { Line } from '../cells'
import { copyToTerminal } from '../copy'
import { Button } from './buttons'

/** fallback: the level is `fallback` because a terminal cannot reach the clipboard portably. Where
 *  the terminal advertises OSC 52 the button works and the level is `full` at runtime; where it does
 *  not, the host prints the value on its own line to copy by hand (../copy.ts). */
// `always` is accepted and ignored. On the DOM host it turns off a hover reveal; a terminal has no
// hover, so this copy is drawn either way and a caller that needs the button visible on both hosts
// should not have to ask twice.
export function CopyButton(props: { text: () => string; onCopy?: (text: string) => void; title?: string; always?: boolean }) {
  const [shown, setShown] = createSignal(false)
  const copy = () => {
    const text = props.text()
    if (props.onCopy) return props.onCopy(text)
    if (!copyToTerminal(text)) setShown(true)
  }
  return (
    <box flexDirection="column">
      <Button variant="bare" label="Copy" onPress={copy} />
      <Show when={shown()}><Line role="mono">{props.text()}</Line></Show>
    </box>
  )
}
