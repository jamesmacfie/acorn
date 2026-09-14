import { createSignal, type Accessor } from 'solid-js'
import type { CredentialField, PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { connectIntegration, rotateIntegration } from './integrationClient'

// The typed-credential half of connecting a provider: the fields a descriptor declares, what has been
// entered, whether that is enough to submit, and the write.
//
// A shared module for the same reason `./deviceFlow.ts` is one. The Integrations page and the
// first-run wizard both add a key, and the parts worth getting right are not the input elements. They
// are which fields are required, what a rejected credential reads as, and that a rotation is a PUT to
// one connection while an addition is a POST to the provider. Those were inline in
// `../settings/IntegrationsSettings.tsx`, tangled with the provider chips and the device-flow branch,
// so the wizard had no way to reach them.
//
// Free of JSX, and of any element, so both hosts can draw it. The wizard renders in the terminal
// client as well as on the desktop (apps/tui/src/roster.ts), and a component built out of
// `<label class="…">` would render there as a placeholder. What crosses is the state and the write;
// each surface draws its own fields out of kit nodes.

export type CredentialFormController = {
  /** What to draw, straight off the descriptor, so nothing provider-specific is written down. */
  fields: Accessor<CredentialField[]>
  value: (fieldId: string) => string
  setValue: (fieldId: string, value: string) => void
  /** Every required field has something in it. A form with no provider is never complete. */
  complete: Accessor<boolean>
  busy: Accessor<boolean>
  error: Accessor<string>
  /** Empty the fields and the error. Callers reach for this when they change what the form is for. */
  reset: () => void
  submit: () => Promise<void>
}

// The two codes worth their own sentence. `provider_needs_auth` means the provider itself refused
// the credential, so retrying the same one is pointless and the reader needs to know whose refusal
// it was. `provider_secret_ref_unreadable` means we never got as far as asking: the value is in
// 1Password and this machine could not read it, which is a different thing to go and fix.
const errorCopy = (code: string, label: string): string => {
  if (code === 'provider_needs_auth') return `Those credentials were rejected by ${label}.`
  if (code === 'provider_secret_ref_unreadable') {
    return 'Could not read that 1Password reference. Check Settings, Security, 1Password.'
  }
  return 'Could not connect this provider.'
}

export function createCredentialForm(
  provider: () => PublicIntegrationProvider | undefined,
  onConnected: () => void | Promise<void>,
  /**
   * The connection to replace, for a rotation. Null adds one.
   *
   * An accessor rather than a value because the Integrations page decides between the two long after
   * the form is mounted: pressing Rotate on a connection points the same form at that connection.
   */
  rotationId: () => string | null = () => null,
): CredentialFormController {
  const [credentials, setCredentials] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const fields = () => provider()?.connection.fields ?? []
  const value = (fieldId: string) => credentials()[fieldId] ?? ''
  const setValue = (fieldId: string, next: string) =>
    setCredentials((current) => ({ ...current, [fieldId]: next }))

  const complete = () =>
    !!provider() && fields().every((field) => !field.required || !!value(field.id).trim())

  const reset = () => {
    setCredentials({})
    setError('')
  }

  const submit = async () => {
    const target = provider()
    // Guarded rather than trusted: Enter in a field reaches this with a half-filled form, and the node
    // would answer 400 for a missing field with no way to say which.
    if (!target || !complete()) return
    setBusy(true)
    setError('')
    try {
      const id = rotationId()
      if (id) await rotateIntegration(id, credentials())
      else await connectIntegration(target.id, credentials())
      reset()
      await onConnected()
    } catch (cause) {
      // The one code worth its own sentence. The provider itself refused the credential, so retrying
      // the same one is pointless and the reader needs to know whose refusal it was.
      const code = (cause as Error).message
      setError(errorCopy(code, target.label))
    } finally {
      setBusy(false)
    }
  }

  return { fields, value, setValue, complete, busy, error, reset, submit }
}
