import { For, Show } from 'solid-js'
import { Chip, ChipRow, Field, Text, Textarea } from '@acorn/plugin-api/ui'

// A prompt, with the references it may use offered as chips.
//
// The chips append rather than insert at the caret. A caret is a DOM position and this component draws
// on both hosts, so appending is the honest thing both can do; the token is what matters and moving it
// is one drag.

export default function PromptField(props: {
  label: string
  hint?: string
  value: string
  required?: boolean
  disabled?: boolean
  /** `${inputs.x}` for every declared input, `${steps.y.output}` for every step that runs first. */
  references: readonly string[]
  onChange: (value: string) => void
}) {
  const missing = () => props.required && !props.value.trim()
  const append = (token: string): void => {
    const current = props.value
    props.onChange(current && !current.endsWith('\n') ? `${current}\n${token}` : `${current}${token}`)
  }
  return (
    <Field
      label={props.label}
      hint={props.hint}
      error={missing() ? 'This one has to be filled in.' : undefined}
      group
    >
      <Textarea
        rows={8}
        grow
        label={props.label}
        disabled={props.disabled}
        invalid={missing()}
        value={props.value}
        placeholder="What this step should do."
        onInput={props.onChange}
      />
      <Show when={!props.disabled && props.references.length}>
        <ChipRow>
          <Text emphasis="muted">Insert</Text>
          <For each={props.references}>
            {(reference) => <Chip size="xs" onPress={() => append(reference)}>{reference}</Chip>}
          </For>
        </ChipRow>
      </Show>
    </Field>
  )
}
