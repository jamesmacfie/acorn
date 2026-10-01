import { Button, Field, Fold, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { Index, Show } from 'solid-js'
import type { WorkflowInput } from '../../shared/workflowContracts'
import TypedValueField from './TypedValueField'
import { INPUT_NAME_RE } from './draft'

/** The list of typed values a workflow is started with. A human gate's form reuses it for its
 *  fields, which are declared the same way, so the wording and the cap are props. */
export default function InputsInspector(props: {
  inputs: readonly WorkflowInput[]
  disabled?: boolean
  onChange: (inputs: WorkflowInput[]) => void
  intro?: string
  addLabel?: string
  max?: number
}) {
  const patch = (at: number, change: Partial<WorkflowInput>): void =>
    props.onChange(props.inputs.map((input, index) => (index === at ? { ...input, ...change } : input)))
  const add = (): void => {
    const taken = new Set(props.inputs.map((input) => input.name))
    let name = 'input'
    for (let n = 2; taken.has(name); n += 1) name = `input${n}`
    props.onChange([...props.inputs, { name, schema: { type: 'string' } }])
  }

  return (
    <Stack gap="stack">
      <Text emphasis="muted" wrap>
        {props.intro ?? `What the run is started with. A prompt reaches one as \${inputs.name}, and so does any string in a step's own settings.`}
      </Text>
      {/* `Index`, so editing one input's description does not remount the row under the caret. */}
      <Index each={props.inputs}>
        {(input, at) => (
          <Fold label={input().name || 'unnamed'} level="group" defaultOpen>
            <Stack gap="row">
              <Field label="Name" error={INPUT_NAME_RE.test(input().name) ? undefined : 'A letter, then letters, numbers or underscores.'} group>
                <Input size="sm" label="Name" assist={false} disabled={props.disabled}
                  invalid={!INPUT_NAME_RE.test(input().name)} value={input().name}
                  onInput={(value) => patch(at, { name: value })} />
              </Field>
              <Field label="Description" hint="Shown beside the box." group>
                <Input size="sm" label="Description" disabled={props.disabled} value={input().description ?? ''}
                  onInput={(value) => patch(at, { description: value || undefined })} />
              </Field>
              <Field label="Type" group>
                <Select size="sm" label="Type" disabled={props.disabled}
                  value={typeof input().schema?.type === 'string' ? input().schema!.type as string : 'string'}
                  options={['string', 'number', 'integer', 'boolean', 'object', 'array'].map(type => ({ value: type, label: type }))}
                  onChange={type => patch(at, { default: undefined, schema: type === 'array' ? { type: 'array', items: { type: 'object' } } : { type: type as 'string' | 'number' | 'integer' | 'boolean' | 'object' } })} />
              </Field>
              <TypedValueField label="Default" disabled={props.disabled} schema={input().schema}
                value={input().default} onChange={(value) => patch(at, { default: value })} />
              <Inline gap="inline">
                <Button size="sm" variant={input().required ? 'solid' : 'outline'} disabled={props.disabled}
                  onPress={() => patch(at, { required: !input().required })}>
                  {input().required ? 'Required' : 'Optional'}
                </Button>
                <Button size="sm" variant="bare" disabled={props.disabled}
                  onPress={() => props.onChange(props.inputs.filter((_entry, index) => index !== at))}>
                  Remove
                </Button>
              </Inline>
            </Stack>
          </Fold>
        )}
      </Index>
      <Show when={!props.disabled && (props.max == null || props.inputs.length < props.max)}>
        <Inline gap="inline"><Button size="sm" onPress={add}>{props.addLabel ?? 'Add an input'}</Button></Inline>
      </Show>
    </Stack>
  )
}
