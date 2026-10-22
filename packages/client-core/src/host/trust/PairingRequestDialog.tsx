import { Portal } from 'solid-js/web'
import { Show } from 'solid-js'
import { Alert, Button } from '../../kit/components/primitives'
import { Modal } from '../../kit/components/overlays/Modal'
import { askerLine, createPairingRequests, denyAdvice } from './pairingRequestModel'

// The desktop's pairing dialog, over the model both clients share (./pairingRequestModel.ts).
export default function PairingRequestDialog() {
  const { asking, busy, error, armed, answer, close } = createPairingRequests()

  // An `alertdialog`, so focus starts on **Deny**, the button that grants nothing. Escape answers
  // nothing, and the request expires on the Node.
  return (
    <Portal>
      <Show when={asking()}>
        {(current) => (
          <Modal title="Allow a new client?" role="alertdialog" size="sm" onDismiss={close}>
            <Modal.Body>
              <p>{askerLine(current())}</p>
              <p>Allow it only if it shows these words:</p>
              <p>
                <strong>{current().request.phrase}</strong>
              </p>
              <p>{denyAdvice(current().request)}</p>
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
