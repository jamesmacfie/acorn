import { Portal } from 'solid-js/web'
import { createSignal, onCleanup, Show } from 'solid-js'
import type { PairingDecision, PairingRequest } from '@acorn/protocol/node.ts'
import { nodes } from '../../infra/node/fleet'
import { answerPairingRequest, readPairingRequest } from '../../infra/node/fleetActions'
import { wsOnFleetPairingRequested } from '../../infra/node/wsClient'
import { Alert, Button } from '../../kit/components/primitives'
import { Modal } from '../../kit/components/overlays/Modal'

// The owner's side of pairing by approval (docs/api-reference/transport.md § Pairing by approval).
//
// It opens by itself when a paired Node says a client on its computer is asking. That is the point:
// whoever just started `acorn` or the browser extension looks at this window next. The request is
// read from the Node's device-only route, never from the frame, which a task-scoped socket hears too.
//
// The phrase is the check. The asker prints the same three words, so a request something else raced
// in shows words the person doesn't recognize.
export default function PairingRequestDialog() {
  const [asking, setAsking] = createSignal<{ nodeId: string; request: PairingRequest } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let expiry: ReturnType<typeof setTimeout> | undefined

  const close = () => {
    clearTimeout(expiry)
    setAsking(null)
    setBusy(false)
    setError('')
  }

  const show = async (nodeId: string) => {
    let request: PairingRequest | null
    try {
      ;({ request } = await readPairingRequest(nodeId))
    } catch {
      return // A Node that can't say what it was asked has nothing to show.
    }
    if (!request) return
    clearTimeout(expiry)
    setError('')
    setAsking({ nodeId, request })
    // The Node forgets the request then, so an answer after it could only fail.
    expiry = setTimeout(close, Math.max(0, request.expiresAt - Date.now()))
  }

  onCleanup(wsOnFleetPairingRequested((nodeId) => void show(nodeId)))
  // A request can arrive before this window does: in tray mode, the request is what opened it. A request
  // the ping shows as well is the same one, so the second read replaces it with itself.
  const local = nodes().find((node) => node.local)
  if (local) void show(local.nodeId)
  onCleanup(() => clearTimeout(expiry))

  const answer = async (decision: PairingDecision['decision']) => {
    const current = asking()
    if (!current) return
    setBusy(true)
    try {
      await answerPairingRequest(current.nodeId, current.request.id, decision)
      close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  const nodeLabel = (nodeId: string) => nodes().find((node) => node.nodeId === nodeId)?.label ?? 'this Node'

  // An `alertdialog`, so focus starts on **Deny**, the button that grants nothing. Escape answers
  // nothing, and the request expires on the Node.
  return (
    <Portal>
      <Show when={asking()}>
        {(current) => (
          <Modal title="Allow a new client?" role="alertdialog" size="sm" onDismiss={close}>
            <Modal.Body>
              <p>
                <strong>{current().request.deviceName}</strong> on the computer running {nodeLabel(current().nodeId)} is
                asking for full access to it.
              </p>
              <p>Allow it only if it shows these words:</p>
              <p>
                <strong>{current().request.phrase}</strong>
              </p>
              <p>If you didn't just start the terminal app or the browser extension, deny it.</p>
              <Show when={error()}>
                <Alert>{error()}</Alert>
              </Show>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="ghost" disabled={busy()} onPress={() => void answer('deny')}>
                Deny
              </Button>
              <Button variant="solid" disabled={busy()} onPress={() => void answer('allow')}>
                {busy() ? 'Working…' : 'Allow'}
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </Portal>
  )
}
