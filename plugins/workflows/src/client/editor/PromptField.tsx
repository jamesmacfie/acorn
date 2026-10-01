import { For, Show } from 'solid-js'
import { useRequiredError } from './FieldControl'
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
  const required = useRequiredError(() => !!props.required && !props.value.trim())
  const change = (value: string): void => {
    required.touch()
    props.onChange(value)
  }
  const append = (token: string): void => {
    const current = props.value
    change(current && !current.endsWith('\n') ? `${current}\n${token}` : `${current}${token}`)
  }
  return (
    <Field
      label={props.label}
      hint={props.hint}
      error={required.error()}
      group
    >
      <Textarea
        rows={8}
        grow
        label={props.label}
        disabled={props.disabled}
        invalid={!!required.error()}
        value={props.value}
        placeholder="What this step should do."
        onBlur={required.touch}
        onInput={change}
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
