import { For, Show } from 'solid-js'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { Button, Field, Fold, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import {
  FIELD_TYPES, objectSchema, removeObjectField, schemaForType, schemaPrimaryType,
  setObjectField, uniqueFieldName, type EditableFieldType,
} from './schemaFields'

function NestedSchema(props: {
  schema: DataSchema
  disabled?: boolean
  depth: number
  onChange: (schema: DataSchema) => void
}) {
  const type = () => schemaPrimaryType(props.schema)
  const changeType = (value: string) => props.onChange(schemaForType(value as EditableFieldType))
  return <Stack gap="row">
    <Field label="Type" group>
      <Select size="sm" label="Type" disabled={props.disabled} value={type()}
        options={FIELD_TYPES.map(value => ({ value, label: value === 'array' ? 'list' : value }))}
        onChange={changeType} />
    </Field>
    <Show when={type() === 'object' && props.depth < 4}>
      <ObjectFields schema={props.schema} disabled={props.disabled} depth={props.depth + 1} onChange={props.onChange} />
    </Show>
    <Show when={type() === 'array'}>
      <Fold label="List item" level="group" defaultOpen>
        <NestedSchema schema={props.schema.items ?? { type: 'string' }} disabled={props.disabled} depth={props.depth + 1}
          onChange={items => props.onChange({ ...props.schema, type: 'array', items })} />
      </Fold>
    </Show>
  </Stack>
}

function ObjectFields(props: {
  schema: DataSchema
  disabled?: boolean
  depth: number
  onChange: (schema: DataSchema) => void
}) {
  const schema = () => objectSchema(props.schema)
  const fields = () => Object.entries(schema().properties ?? {})
  const add = () => {
    const name = uniqueFieldName(schema())
    props.onChange(setObjectField(schema(), '', name, { type: 'string' }, false))
  }
  return <Stack gap="row">
    <For each={fields()}>{([name, value]) => {
      const required = () => (schema().required ?? []).includes(name)
      const rename = (nextName: string) => {
        if (!nextName.trim() || (nextName !== name && Object.hasOwn(schema().properties ?? {}, nextName))) return
        props.onChange(setObjectField(schema(), name, nextName, value, required()))
      }
      return <Fold label={name} level="group" defaultOpen={props.depth === 1}>
        <Stack gap="row">
          <Field label="Field name" group>
            <Input size="sm" label="Field name" disabled={props.disabled} value={name} onChange={rename} />
          </Field>
          <NestedSchema schema={value} disabled={props.disabled} depth={props.depth}
            onChange={next => props.onChange(setObjectField(schema(), name, name, next, required()))} />
          <Inline gap="inline">
            <Button size="sm" variant={required() ? 'solid' : 'outline'} disabled={props.disabled}
              onPress={() => props.onChange(setObjectField(schema(), name, name, value, !required()))}>
              {required() ? 'Required' : 'Optional'}
            </Button>
            <Button size="sm" variant="bare" disabled={props.disabled}
              onPress={() => props.onChange(removeObjectField(schema(), name))}>Remove</Button>
          </Inline>
        </Stack>
      </Fold>
    }}</For>
    <Show when={!fields().length}><Text emphasis="muted">No fields declared yet.</Text></Show>
    <Button size="sm" disabled={props.disabled || props.depth >= 4} onPress={add}>Add field</Button>
  </Stack>
}

/** The normal manual editor for an agent's structured result. JSON remains available in the code
 *  view, but the common object/list contract never requires writing it. */
export default function SchemaFieldEditor(props: {
  label: string
  value: unknown
  disabled?: boolean
  onChange: (schema: DataSchema | undefined) => void
}) {
  const schema = () => objectSchema(props.value)
  return <Fold label={props.label} level="group" defaultOpen>
    <Stack gap="row">
      <Text emphasis="muted" wrap>Describe the fields the agent returns. These names and types are checked before the step completes.</Text>
      <ObjectFields schema={schema()} disabled={props.disabled} depth={1} onChange={props.onChange} />
      <Show when={Object.keys(schema().properties ?? {}).length}>
        <Button size="sm" variant="bare" disabled={props.disabled} onPress={() => props.onChange(undefined)}>Clear structured output</Button>
      </Show>
    </Stack>
  </Fold>
}
