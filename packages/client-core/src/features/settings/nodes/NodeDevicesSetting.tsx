import { createResource, createSignal, For, Show } from 'solid-js'
import { readNodeDevices, revokeNodeDevice, setNodeDeviceShellAccess } from '../../../infra/node/fleetActions'
import { formatRelativeTime } from '../../../kit/lib/rendering/formatRelativeTime'
import { Alert, Badge, Button, ConfirmButton } from '../../../kit/components/primitives'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'

// The devices paired with a Node and when each last used it, with the one action that signs one of them
// out of it (docs/authentication.md § Device tokens). A phone has a device of its own, so this is where
// one lost phone is revoked and the others carry on. A Node from before the route has none to show.
// It's also where a computer gives a phone shell access, which a phone can't give itself
// (docs/relay/phone-channel/phone-devices.md § Shell access).
export function NodeDevicesSetting(props: { nodeId: string }) {
  const [devices, { refetch }] = createResource(
    () => props.nodeId,
    (nodeId) => readNodeDevices(nodeId).then((answer) => answer.devices.filter((device) => !device.revokedAt)),
  )
  const [error, setError] = createSignal('')

  const change = async (write: () => Promise<void>) => {
    setError('')
    try {
      await write()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    await refetch()
  }
  const revoke = (deviceId: string) => change(() => revokeNodeDevice(props.nodeId, deviceId))
  const shellAccess = (deviceId: string, granted: boolean) =>
    change(() => setNodeDeviceShellAccess(props.nodeId, deviceId, granted))

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
                <Show when={device.shellAccess}>
                  <Badge tone="warn">Shell access</Badge>
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
                <Show when={device.kind === 'phone'}>
                  <Show
                    when={device.shellAccess}
                    fallback={
                      <ConfirmButton
                        size="sm"
                        tone="warn"
                        confirmLabel="Let it run commands?"
                        title="The phone can then run commands on this Node. So can anyone who changes the account website, or who holds the phone unlocked."
                        onConfirm={() => void shellAccess(device.id, true)}
                      >
                        Give shell access
                      </ConfirmButton>
                    }
                  >
                    <Button size="sm" onPress={() => void shellAccess(device.id, false)}>
                      Remove shell access
                    </Button>
                  </Show>
                </Show>
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
