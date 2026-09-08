import { createEffect, createSignal, on, Show } from 'solid-js'
import { Alert, Button, Inline, Stack, Text, Textarea } from '@acorn/plugin-api/ui'

// The escape hatch: the definition as the runner's own JSON.
//
// A plain textarea rather than a code editor, because the kit admits no editor node and a plugin may
// not reach for one directly (docs/ui-design.md § The closed kit). Apply is atomic — a document that
// does not parse leaves the draft alone and stays in the box for correction — and Revert puts the
// draft's own projection back.

export default function JsonTab(props: {
  /** The draft as JSON. Read on mount and on Revert, not on every keystroke: the box is the reader's
   *  until they apply it. */
  json: string
  readOnly?: boolean
  onApply: (text: string) => string | undefined
}) {
  const [text, setText] = createSignal(props.json)
  const [error, setError] = createSignal<string | undefined>()
  const [applied, setApplied] = createSignal(false)

  // A new definition in the same surface replaces the box. `on` over the JSON, which is a string, so
  // it fires when the document changes rather than when the draft object is rebuilt.
  createEffect(on(() => props.json, (next, previous) => {
    if (previous === undefined || !text().trim()) setText(next)
  }))

  const apply = (): void => {
    const problem = props.onApply(text())
    setError(problem)
    setApplied(!problem)
  }
  const format = (): void => {
    try {
      setText(`${JSON.stringify(JSON.parse(text()) as unknown, null, 2)}\n`)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That is not JSON.')
    }
  }
  const revert = (): void => {
    setText(props.json)
    setError(undefined)
    setApplied(false)
  }

  return (
    <Stack gap="row">
      <Show when={error()}>
        {(message) => <Alert tone="danger">{message()}</Alert>}
      </Show>
      <Show when={!error() && applied()}>
        <Text emphasis="muted">Applied to the draft. Save to keep it.</Text>
      </Show>
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
      <Inline gap="inline">
        <Button size="sm" disabled={props.readOnly} onPress={apply}>Apply</Button>
        <Button size="sm" variant="bare" onPress={format}>Format</Button>
        <Button size="sm" variant="bare" onPress={revert}>Revert</Button>
      </Inline>
    </Stack>
  )
}
