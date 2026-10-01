import { For, type JSX } from 'solid-js'
import type { createCredentialForm } from '../../integrations/credentialForm'
import { Field, Input } from '../../../kit/components/primitives'
import { Stack } from '../../../kit/components/layout/Stack'

// The fields a provider asks for, as a page form: Add connection and Replace key draw the same ones,
// so they share this rather than two loops that drift. `children` is the form's error and buttons, which
// sit in the same stack so they keep the fields' spacing rather than touching the last hint.
export function CredentialFields(props: { form: ReturnType<typeof createCredentialForm>; children?: JSX.Element }) {
  return (
    <Stack gap="stack">
      <For each={props.form.fields()}>
        {(field) => (
          <Field label={field.label} hint={field.hint}>
            <Input
              type={field.type}
              assist={false}
              placeholder={field.placeholder}
              value={props.form.value(field.id)}
              onInput={(value) => props.form.setValue(field.id, value)}
              onSubmit={() => void props.form.submit()}
            />
          </Field>
        )}
      </For>
      {props.children}
    </Stack>
  )
}
