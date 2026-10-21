import { Portal } from 'solid-js/web'
import { createSignal, onCleanup, Show } from 'solid-js'
import type { PairingDecision, PairingRequest } from '@acorn/protocol/node.ts'
import { toast } from '../../features/notifications/toast'
import { nodes } from '../../infra/node/fleet'
import { answerPairingRequest, readPairingRequest } from '../../infra/node/fleetActions'
import { wsOnFleetPairingRequested } from '../../infra/node/wsClient'
import { Alert, Button } from '../../kit/components/primitives'
import { Modal } from '../../kit/components/overlays/Modal'

const ALLOW_DELAY_MS = 1_000

// The owner's side of pairing by approval (docs/api-reference/transport.md § Pairing by approval).
//
// It opens by itself when a paired Node says a client on its computer is asking. That is the point:
// whoever just started `acorn` or the browser extension looks at this window next. The request is
// read from the Node's device-only route, never from the frame, which a task-scoped socket hears too.
//
// The phrase is the check. The asker prints the same three words, so a request something else raced
// in shows words the person doesn't recognize. The words on screen never change under the cursor: a
// frame that brings a different request, or none, closes the dialog instead of replacing what the
// person is reading. **Allow** also waits a second after the dialog opens, so a click meant for
// something else can't land on it.
export default function PairingRequestDialog() {
  const [asking, setAsking] = createSignal<{ nodeId: string; request: PairingRequest } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [armed, setArmed] = createSignal(false)
  let expiry: ReturnType<typeof setTimeout> | undefined
  let arming: ReturnType<typeof setTimeout> | undefined

  const close = () => {
    clearTimeout(expiry)
    clearTimeout(arming)
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
    const showing = asking()
    if (showing) {
      if (request?.id === showing.request.id) return
      close()
      toast('Another pairing request arrived, so this one was cancelled.')
      return
    }
    if (!request) return
    setError('')
    setAsking({ nodeId, request })
    setArmed(false)
    arming = setTimeout(() => setArmed(true), ALLOW_DELAY_MS)
    // The Node forgets the request then, so an answer after it could only fail.
    expiry = setTimeout(close, Math.max(0, request.expiresAt - Date.now()))
  }

  onCleanup(wsOnFleetPairingRequested((nodeId) => void show(nodeId)))
  // A request can arrive before this window does: in tray mode, the request is what opened it. A request
  // the ping shows as well is the same one, which the second read leaves alone.
  const local = nodes().find((node) => node.local)
  if (local) void show(local.nodeId)
  onCleanup(() => {
    clearTimeout(expiry)
    clearTimeout(arming)
  })

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
              <Button variant="solid" disabled={busy() || !armed()} onPress={() => void answer('allow')}>
                {busy() ? 'Working…' : 'Allow'}
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </Portal>
  )
}
