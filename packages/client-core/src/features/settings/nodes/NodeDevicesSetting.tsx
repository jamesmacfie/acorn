import { createResource, createSignal, For, Show } from 'solid-js'
import { readNodeDevices, revokeNodeDevice } from '../../../infra/node/fleetActions'
import { formatRelativeTime } from '../../../kit/lib/rendering/formatRelativeTime'
import { Alert, Badge, ConfirmButton } from '../../../kit/components/primitives'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'

// The devices paired with a Node and when each last used it, with the one action that signs one of them
// out of it (docs/authentication.md § Device tokens). A phone has a device of its own, so this is where
// one lost phone is revoked and the others carry on. A Node from before the route has none to show.
export function NodeDevicesSetting(props: { nodeId: string }) {
  const [devices, { refetch }] = createResource(
    () => props.nodeId,
    (nodeId) => readNodeDevices(nodeId).then((answer) => answer.devices.filter((device) => !device.revokedAt)),
  )
  const [error, setError] = createSignal('')

  const revoke = async (deviceId: string) => {
    setError('')
    try {
      await revokeNodeDevice(props.nodeId, deviceId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    await refetch()
  }

  return (
    <Show when={!devices.error && devices()}>
      {(list) => (
        <Stack gap="row">
          <Text emphasis="strong">Paired devices</Text>
          <For each={list()}>
            {(device) => (
              <Inline gap="row" wrap>
                <Text>{device.name}</Text>
                <Show when={device.kind === 'phone'}>
                  <Badge>Phone</Badge>
                </Show>
                <Text emphasis="muted">
                  {device.lastSeenAt ? `used ${formatRelativeTime(device.lastSeenAt)}` : 'not used yet'}
                </Text>
                <ConfirmButton
                  size="sm"
                  tone="danger"
                  confirmLabel="Revoke device?"
                  title="This device can no longer reach the Node. It has to pair again."
                  onConfirm={() => void revoke(device.id)}
                >
                  Revoke
                </ConfirmButton>
              </Inline>
            )}
          </For>
          <Show when={error()}>
            <Alert>{error()}</Alert>
          </Show>
        </Stack>
      )}
    </Show>
  )
}
