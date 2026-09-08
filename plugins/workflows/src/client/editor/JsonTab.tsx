import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { Alert, Button, Inline, Only, Rectangle, Stack, Text, Textarea } from '@acorn/plugin-api/ui'
import { mountEmbeddedEditor, type EmbeddedEditor } from '@acorn/plugin-api/ui/editor'

// The escape hatch: the definition as the runner's own JSON.
//
// The box is a rectangle rather than a node, because what fills it is a code editor and that is the
// one shape the closed kit cannot express (docs/ui-design.md § The closed kit). The editor itself is
// the host's — the library, the theme and the JSON grammar all arrive through
// `@acorn/plugin-api/ui/editor`, so this file holds no CodeMirror and the terminal client carries
// none. There the same rectangle is a plain textarea, which is what a host with cells can draw.
//
// The text stays this component's either way: it is the reader's until they apply it. Apply is atomic
// — a document that does not parse leaves the draft alone and stays in the box for correction — and
// Revert puts the draft's own projection back.

export default function JsonTab(props: {
  /** The draft as JSON. Read on mount and on Revert, not on every keystroke. */
  json: string
  readOnly?: boolean
  onApply: (text: string) => string | undefined
}) {
  const [text, setText] = createSignal(props.json)
  const [error, setError] = createSignal<string | undefined>()
  const [applied, setApplied] = createSignal(false)

  // The editor, once the host has handed over an element. It stays undefined where there is no
  // element to hand over, which is the terminal, and every write below is written to survive that.
  let editor: EmbeddedEditor | undefined
  onCleanup(() => editor?.destroy())

  /** A replacement from outside the box: a new definition, a Format, a Revert. */
  const replace = (next: string): void => {
    setText(next)
    editor?.write(next)
  }

  // A new definition in the same surface replaces the box. `on` over the JSON, which is a string, so
  // it fires when the document changes rather than when the draft object is rebuilt.
  createEffect(on(() => props.json, (next, previous) => {
    if (previous === undefined || !text().trim()) replace(next)
  }))

  const apply = (): void => {
    const problem = props.onApply(text())
    setError(problem)
    setApplied(!problem)
  }
  const format = (): void => {
    try {
      replace(`${JSON.stringify(JSON.parse(text()) as unknown, null, 2)}\n`)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That is not JSON.')
    }
  }
  const revert = (): void => {
    replace(props.json)
    setError(undefined)
    setApplied(false)
  }

  return (
    <Stack gap="row" grow>
      <Show when={error()}>
        {(message) => <Alert tone="danger">{message()}</Alert>}
      </Show>
      <Show when={!error() && applied()}>
        <Text emphasis="muted">Applied to the draft. Save to keep it.</Text>
      </Show>
      <Rectangle
        kind="editor"
        label="Workflow as JSON"
        // Once, with the box the host drew. `readOnly` is read here rather than watched: a committed
        // file and a database row are two different surfaces, and moving between them rebuilds this
        // one (../WorkflowsBrowse.tsx keys on the item).
        mount={(element) => {
          editor = mountEmbeddedEditor(element, {
            doc: text(),
            languageId: 'json',
            ...(props.readOnly ? { readOnly: true } : {}),
            onChange: (next) => {
              setText(next)
              setApplied(false)
            },
          })
        }}
      >
        <Only hosts={['tui']}>
          <Textarea
            grow
            mono
            assist={false}
            label="Workflow as JSON"
            readOnly={props.readOnly}
            invalid={!!error()}
            value={text()}
            onInput={(value) => {
              setText(value)
              setApplied(false)
            }}
          />
        </Only>
      </Rectangle>
      <Inline gap="inline">
        <Button size="sm" disabled={props.readOnly} onPress={apply}>Apply</Button>
        <Button size="sm" variant="bare" onPress={format}>Format</Button>
        <Button size="sm" variant="bare" onPress={revert}>Revert</Button>
      </Inline>
    </Stack>
  )
}
