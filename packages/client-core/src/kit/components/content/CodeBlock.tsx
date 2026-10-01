import { createSignal, Show, type JSX } from 'solid-js'
import { IconButton } from '../inputs/IconButton'

/* CodeBlock: the mono sunken block. Syntax highlighting stays out; callers that highlight pass
   tokenized children. A code textarea is `Textarea mono` instead. Logs that stream keep their own
   scroll-follow logic, because this is the box, not the tail. */
export function CodeBlock(props: {
  /** `true` copies the rendered text; a string copies that instead. */
  copy?: boolean | string
  /** Sandboxed frames have no `navigator.clipboard`, so they pass their bridge's copy here. */
  onCopy?: (text: string) => void
  wrap?: boolean
  size?: 'xs' | 'sm'
  maxHeight?: 'none' | 'block'
  children: JSX.Element
}) {
  let codeRef: HTMLElement | undefined
  const copyText = () => (typeof props.copy === 'string' ? props.copy : codeRef?.textContent ?? '')
  return (
    <div class="ui-code-wrap">
      <pre
        class="ui-code"
        data-wrap={props.wrap ? '' : undefined}
        data-size={props.size ?? 'sm'}
        data-max={props.maxHeight ?? 'none'}
      ><code ref={(el) => { codeRef = el }}>{props.children}</code></pre>
      <Show when={props.copy}>
        <CopyButtonSlot text={copyText} onCopy={props.onCopy} />
      </Show>
    </div>
  )
}

// Inline rather than importing inputs/CopyButton: that component reaches `navigator.clipboard`
// directly, which a sandboxed frame cannot do. Here the clipboard call is injectable.
function CopyButtonSlot(props: { text: () => string; onCopy?: (text: string) => void }) {
  const [done, setDone] = createSignal(false)
  return (
    <IconButton
      icon={done() ? 'check' : 'copy'}
      label={done() ? 'Copied' : 'Copy'}
      onPress={() => {
        const text = props.text()
        if (props.onCopy) props.onCopy(text)
        else void navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    />
  )
}
