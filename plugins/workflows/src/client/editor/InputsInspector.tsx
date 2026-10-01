import { Button, Checkbox, Field, Fold, Icon, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { Index, Show } from 'solid-js'
import type { WorkflowInput } from '../../shared/workflowContracts'
import TypedValueField from './TypedValueField'
import { INPUT_NAME_RE } from './draft'

/** The words for each schema type, shared with the result-schema editor (./SchemaFieldEditor.tsx). */
export const TYPE_LABELS: Record<string, string> = {
  string: 'Text', number: 'Number', integer: 'Whole number', boolean: 'Yes or no', object: 'Object', array: 'List',
}

/** The list of typed values a workflow is started with. A human gate's form reuses it for its
 *  fields, which are declared the same way, so the wording and the cap are props. The workflow's
 *  own explanation is help on the inspector's Inputs heading, so `intro` is only the gate's. */
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
      <Show when={props.intro}>{(intro) => <Text emphasis="muted" wrap>{intro()}</Text>}</Show>
      {/* `Index`, so editing one input's description does not remount the row under the caret. */}
      <Index each={props.inputs}>
        {(input, at) => (
          <Fold label={input().name || 'unnamed'} level="sub" defaultOpen>
            <Stack gap="row">
              <Field label="Name" error={INPUT_NAME_RE.test(input().name) ? undefined : 'Start with a letter. Use only letters, numbers, and underscores.'} group>
                <Input label="Name" assist={false} disabled={props.disabled}
                  invalid={!INPUT_NAME_RE.test(input().name)} value={input().name}
                  onInput={(value) => patch(at, { name: value })} />
              </Field>
              <Field label="Label" hint="Shown in place of the name. Leave it empty to show the name." group>
                <Input label="Label" disabled={props.disabled} value={input().label ?? ''}
                  onInput={(value) => patch(at, { label: value || undefined })} />
              </Field>
              <Field label="Description" hint="Shown beside the box." group>
                <Input label="Description" disabled={props.disabled} value={input().description ?? ''}
                  onInput={(value) => patch(at, { description: value || undefined })} />
              </Field>
              <Field label="Type" group>
                <Select label="Type" disabled={props.disabled}
                  value={typeof input().schema?.type === 'string' ? input().schema!.type as string : 'string'}
                  options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                  onChange={type => patch(at, { default: undefined, schema: type === 'array' ? { type: 'array', items: { type: 'object' } } : { type: type as 'string' | 'number' | 'integer' | 'boolean' | 'object' } })} />
              </Field>
              <TypedValueField label="Default" disabled={props.disabled} schema={input().schema}
                value={input().default} onChange={(value) => patch(at, { default: value })} />
              <Inline gap="row">
                <Checkbox label="Required" checked={!!input().required} disabled={props.disabled}
                  onChange={(checked) => patch(at, { required: checked })} />
                <Button size="sm" variant="ghost" disabled={props.disabled}
                  onPress={() => props.onChange(props.inputs.filter((_entry, index) => index !== at))}>
                  Remove
                </Button>
              </Inline>
            </Stack>
          </Fold>
        )}
      </Index>
      <Show when={!props.disabled && (props.max == null || props.inputs.length < props.max)}>
        <Inline gap="inline"><Button size="sm" onPress={add}><Icon name="plus" /> {props.addLabel ?? 'Add an input'}</Button></Inline>
      </Show>
    </Stack>
  )
}
