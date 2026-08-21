import { createResource, createSignal, For, Show } from 'solid-js'
import type { PairedDevice } from '@acorn/protocol/node.ts'
import { nodeDevices, revokeNodeDevice } from '../node/fleetActions'
import { formatLastSeen } from '../node/freshness'
import { Button } from '../ui/primitives'

// Every client paired with one node, with a revoke per row (docs/security.md § Trust boundaries):
// every paired device has full owner authority, which is exactly why the list has to be visible.
// `removeNode(nodeId, revoke)` deletes only this client's device row, so this is what lets a lost or
// reinstalled machine be cut off without re-pairing everything.
//
// Collapsed by default. On a single-node install with one device this is a row that says "you are
// here", and unfolding it is the act of auditing access.
export default function NodeDevices(props: { nodeId: string; onError: (message: string) => void }) {
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal('')
  const [devices, { refetch, mutate }] = createResource(
    () => (open() ? props.nodeId : null),
    (nodeId) => nodeDevices(nodeId),
  )

  const revoke = async (device: PairedDevice) => {
    props.onError('')
    setBusy(device.id)
    try {
      await revokeNodeDevice(props.nodeId, device.id)
      // Optimistic, then refetch: revoking closes that device's sockets immediately
      // (docs/security.md § Transport and auth), so the row should go at once rather than after a
      // round trip.
      mutate((current) => (current ?? []).filter((candidate) => candidate.id !== device.id))
      await refetch()
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
      await refetch()
    } finally {
      setBusy('')
    }
  }

  const active = () => (devices() ?? []).filter((device) => device.revokedAt === null)

  return (
    <div class="node-devices">
      <Button variant="bare" class="node-devices-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
        {open() ? 'Hide paired clients' : 'Paired clients…'}
      </Button>
      <Show when={open()}>
        <Show when={devices.loading}><p class="muted">Reading the device list…</p></Show>
        <Show when={!devices.loading && !active().length}>
          {/* Not an empty state to celebrate: it means the node could not be asked. This client is paired
              with it by definition, so a genuinely empty list is impossible. */}
          <p class="muted">This node did not report its paired clients. It may be offline.</p>
        </Show>
        <ul class="node-device-list">
          <For each={active()}>
            {(device) => (
              <li class="node-device">
                <span class="node-device-name">{device.name}</span>
                <span class="muted">last seen {formatLastSeen(device.lastSeenAt ?? undefined)}</span>
                <Button class="node-danger"
                  disabled={busy() === device.id}
                  /* No "is this me?" guard. The client cannot know which row is its own, since the device id
                     it was issued lives in main, not here, and revoking yourself is a legitimate action that
                     `removeNode(nodeId, true)` already performs from the row below. */
                  onClick={() => void revoke(device)}
                >
                  Revoke
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
