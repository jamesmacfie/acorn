import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { Button } from '../../kit/components/primitives'
import { nodeIsStarting, nodes, nodeState } from '../../infra/node/fleet'
import { reconnectNode } from '../../infra/node/fleetActions'
import { fleetBridge } from '../../infra/platform'
import { toast } from '../notifications/toast'

// The broker's reconnect tells us nothing back, so we watch the node's status instead. This is long
// enough for the five-second version check plus the socket opening on a slow network.
export const RECONNECT_WAIT_MS = 15_000

// Shown only while the node is offline. A node that is still starting, or one with no broker behind
// it, has nothing to reconnect.
export default function NodeReconnectButton(props: { nodeId: string }) {
  const [waiting, setWaiting] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    clearTimeout(timer)
    setWaiting(false)
  }
  onCleanup(stop)

  createEffect(() => {
    if (waiting() && nodeState(props.nodeId) !== 'offline') stop()
  })

  const reconnect = () => {
    const id = props.nodeId
    setWaiting(true)
    reconnectNode(id)
    timer = setTimeout(() => {
      stop()
      const label = nodes().find((node) => node.nodeId === id)?.label ?? id
      toast(`Could not reconnect to ${label}.`, { tone: 'danger', action: { label: 'Try again', onPress: reconnect } })
    }, RECONNECT_WAIT_MS)
  }

  return (
    <Show when={fleetBridge() && nodeState(props.nodeId) === 'offline' && !nodeIsStarting(props.nodeId)}>
      <Button size="sm" variant="ghost" busy={waiting()} onPress={reconnect}>
        Reconnect
      </Button>
    </Show>
  )
}
