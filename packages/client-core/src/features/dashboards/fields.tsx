import { createSignal } from 'solid-js'
import { Field, Input, Select, type InputProps, type SelectProps } from '../../kit/components/primitives'

/** A Select or Input with its caption showing. The kit control uses `label` only as its accessible
 *  name, so without a Field round each one the editor read as a row of bare values. */
export const LabeledSelect = (props: SelectProps & { label: string; hint?: string }) => <Field label={props.label} hint={props.hint}><Select size="sm" {...props} /></Field>
export const LabeledInput = (props: InputProps & { label: string; hint?: string }) => <Field label={props.label} hint={props.hint}><Input assist={false} {...props} /></Field>

/** A panel title edited in place, in the studio toolbar and a placed panel's header. Enter or leaving
 *  the field commits; Escape cancels. */
export function TitleField(props: { value: string; onDone: (title: string | undefined) => void }) {
  const [value, setValue] = createSignal(props.value)
  let done = false
  const finish = (title: string | undefined) => {
    if (done) return
    done = true
    props.onDone(title?.trim() ? title : undefined)
  }
  return <Input label="Panel title" value={value()} onInput={setValue}
    ref={element => queueMicrotask(() => { element.focus(); element.select() })}
    onBlur={() => finish(value())}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(value()) }
      if (event.key === 'Escape') { event.preventDefault(); finish(undefined) }
    }} />
}
