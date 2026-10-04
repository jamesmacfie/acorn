import { Field, Input, Select, type InputProps, type SelectProps } from '../../kit/components/primitives'

/** A Select or Input with its caption showing. The kit control uses `label` only as its accessible
 *  name, so without a Field round each one the editor read as a row of bare values. */
export const LabeledSelect = (props: SelectProps & { label: string }) => <Field label={props.label}><Select size="sm" {...props} /></Field>
export const LabeledInput = (props: InputProps & { label: string }) => <Field label={props.label}><Input assist={false} {...props} /></Field>
