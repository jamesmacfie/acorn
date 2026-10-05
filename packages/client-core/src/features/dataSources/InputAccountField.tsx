import { Show } from 'solid-js'
import type { Integration } from '@acorn/protocol/api.ts'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { Button, Field, Inline, Select, Text } from './kit.ts'

// The account a derived source's input reads with (docs/data-sources/derived-sources.md § Use one in
// a panel). The panel launcher and the source picker both draw it, so choosing an input's account
// looks the same in both. With no account to choose, it says so and offers to connect one: a loaded
// plugin can't open Settings, so the host draws that button.

export default function InputAccountField(props: {
  label: string
  optional?: boolean
  /** Who the account is with, such as "GitHub". */
  provider: string
  connections: readonly Integration[]
  /** The bound account, or undefined while the input has none. */
  value: string | undefined
  /** True while the input is bound, so an optional input can be skipped. */
  bound: boolean
  disabled?: boolean
  /** An account to bind, or undefined to leave the input unbound, which skips an optional one. */
  onChange: (connectionId: string | undefined) => void
}) {
  const label = () => props.optional ? `${props.label} (optional)` : props.label
  return (
    <Show when={props.connections.length} fallback={<Field label={label()} group>
      <Text emphasis="muted" wrap>{`No ${props.provider} account is connected.`}</Text>
      <Inline gap="inline" wrap>
        <Button size="sm" disabled={props.disabled} onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>{`Connect ${props.provider}…`}</Button>
        <Show when={props.optional && props.bound}><Button size="sm" variant="ghost" disabled={props.disabled} onPress={() => props.onChange(undefined)}>Skip this input</Button></Show>
      </Inline>
    </Field>}>
      <Field label={label()} group>
        <Select size="sm" label={label()} disabled={props.disabled} value={props.bound ? props.value ?? '' : ''}
          options={[{ value: '', label: props.optional ? 'Skip' : 'Choose an account…' },
            ...props.connections.map(connection => ({ value: connection.id, label: connection.name ?? connection.label }))]}
          onChange={value => props.onChange(value || undefined)} />
      </Field>
    </Show>
  )
}
