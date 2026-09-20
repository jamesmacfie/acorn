import { createEffect, createSignal } from 'solid-js'
import { Field, Input } from '@acorn/plugin-api/ui'
import { validateDataValue, type DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'

/** Text schemas use plain text; every other schema uses JSON without inferred conversion. */
export default function TypedValueField(props: {
  label: string
  schema?: DataSchema
  value?: DataValue
  disabled?: boolean
  required?: boolean
  onChange(value: DataValue | undefined): void
  onValidity?(valid: boolean): void
}) {
  const textSchema = () => !props.schema || props.schema.type === 'string'
  const [text, setText] = createSignal('')
  const [error, setError] = createSignal<string>()
  createEffect(() => setText(props.value === undefined ? '' : textSchema() && typeof props.value === 'string' ? props.value : JSON.stringify(props.value)))
  const update = (raw: string): void => {
    setText(raw)
    try {
      const value = raw === '' ? undefined : textSchema() ? raw : JSON.parse(raw)
      if (value === undefined && props.required) throw new Error('A value is required.')
      if (value !== undefined && props.schema) validateDataValue(value, props.schema)
      setError(undefined)
      props.onValidity?.(true)
      props.onChange(value)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enter a valid value.')
      props.onValidity?.(false)
    }
  }
  return <Field label={props.label} error={error()} hint={textSchema() ? undefined : 'Enter a JSON value.'} group>
    <Input size="sm" label={props.label} disabled={props.disabled} value={text()} invalid={!!error()} onInput={update} />
  </Field>
}
