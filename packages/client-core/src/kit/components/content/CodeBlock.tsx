import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import type { AnsiTok } from '../../../infra/highlight/shiki'
import { hasAnsi, stripAnsi } from '../../lib/rendering/ansi'
import { IconButton } from '../inputs/IconButton'

/* CodeBlock: the mono sunken block. Syntax highlighting stays out; callers that highlight pass
   tokenized children. Terminal colour is the exception, behind `ansi`, because every caller showing
   a command's output would otherwise parse escape codes for itself. A code textarea is
   `Textarea mono` instead. Logs that stream keep their own scroll-follow logic, because this is the
   box, not the tail. */
export function CodeBlock(props: {
  /** `true` copies the rendered text; a string copies that instead. */
  copy?: boolean | string
  /** Sandboxed frames have no `navigator.clipboard`, so they pass their bridge's copy here. */
  onCopy?: (text: string) => void
  wrap?: boolean
  size?: 'xs' | 'sm'
  maxHeight?: 'none' | 'block'
  /** The text is a terminal's output. Its colour codes draw as colour and every other escape code is
   *  dropped. Applies when the children are a string. */
  ansi?: boolean
  children: JSX.Element
}) {
  let codeRef: HTMLElement | undefined
  const copyText = () => (typeof props.copy === 'string' ? props.copy : codeRef?.textContent ?? '')
  const ansiText = () => (props.ansi && typeof props.children === 'string' && hasAnsi(props.children) ? props.children : undefined)
  const coloured = useAnsiLines(ansiText)
  return (
    <div class="ui-code-wrap">
      <pre
        class="ui-code"
        data-wrap={props.wrap ? '' : undefined}
        data-size={props.size ?? 'sm'}
        data-max={props.maxHeight ?? 'none'}
      ><code ref={(el) => { codeRef = el }}>
        {/* The stripped text until the colours arrive, so a reader never sees the raw codes. */}
        <Show when={ansiText()} fallback={props.children}>
          {(text) => <Show when={coloured()} fallback={stripAnsi(text())}>{(lines) => ansiRuns(lines())}</Show>}
        </Show>
      </code></pre>
      <Show when={props.copy}>
        <CopyButtonSlot text={copyText} onCopy={props.onCopy} />
      </Show>
    </div>
  )
}

// Colour comes from the Shiki themes the diffs use, so a terminal's red is the same red in both, and
// it follows the app between light and dark. The import is dynamic, as Markdown's fences are, so a
// block with no escape codes never loads the highlighter. Lines are kept with the text they came
// from: output that streams in shows plain until its own lines are ready, never an older colouring.
function useAnsiLines(text: () => string | undefined): () => AnsiTok[][] | undefined {
  const [result, setResult] = createSignal<{ text: string; lines: AnsiTok[][] }>()
  createEffect(() => {
    const source = text()
    if (source === undefined) return
    let live = true
    onCleanup(() => { live = false })
    void import('../../../infra/highlight/shiki')
      .then(async ({ getHighlighter, tokenizeAnsiLines }) => {
        const lines = tokenizeAnsiLines(await getHighlighter(), source)
        if (live) setResult({ text: source, lines })
      })
      // A highlighter that fails to load leaves the stripped text, which is the right fallback.
      .catch(() => undefined)
  })
  return () => {
    const current = result()
    return current && current.text === text() ? current.lines : undefined
  }
}

// One span per styled run. An unstyled run stays a bare string, which is most of any output. The
// colours ride as --l/--r and the stylesheet picks a side, as a diff row's do (primitives.css § CodeBlock).
const ansiRuns = (lines: AnsiTok[][]): JSX.Element =>
  lines.map((line, index) => [
    index > 0 ? '\n' : '',
    line.map((run) => (run.light || run.lightBg || run.bold || run.italic || run.underline
      ? (
        <span
          data-fg={run.light ? '' : undefined}
          data-bg={run.lightBg ? '' : undefined}
          style={{
            '--l': run.light || undefined,
            '--r': run.dark || undefined,
            '--lb': run.lightBg || undefined,
            '--rb': run.darkBg || undefined,
            'font-weight': run.bold ? 'bold' : undefined,
            'font-style': run.italic ? 'italic' : undefined,
            'text-decoration': run.underline ? 'underline' : undefined,
          }}
        >{run.content}</span>
      )
      : run.content)),
  ])

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
