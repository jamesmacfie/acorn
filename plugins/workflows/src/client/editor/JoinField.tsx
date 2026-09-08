import { Show } from 'solid-js'
import { Field, Select, Text } from '@acorn/plugin-api/ui'

// A `join` step names the `fan-out` it collects. The choices are the fan-out steps that run before
// this one, which is the rule the validator applies, so the picker cannot offer a definition the node
// would refuse (../../server/workflowValidation.ts).

export default function JoinField(props: {
  value: string
  /** The fan-out steps that precede this one. */
  fanOuts: readonly string[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field label="Fan-out step" hint="The fan-out whose children this step waits for." group>
      <Show
        when={props.fanOuts.length}
        fallback={<Text emphasis="muted" wrap>No fan-out step runs before this one yet.</Text>}
      >
        <Select
          size="sm"
          label="Fan-out step"
          disabled={props.disabled}
          value={props.value}
          options={[{ value: '', label: 'Not set' }, ...props.fanOuts.map((name) => ({ value: name, label: name }))]}
          onChange={props.onChange}
        />
      </Show>
    </Field>
  )
}
