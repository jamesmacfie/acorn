import { createSignal, onCleanup, Show } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import type { PairingWindow } from '@acorn/protocol/node.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { closeNodePairingWindow, openNodePairingWindow } from '../../../infra/node/fleetActions'
import { Alert, Button } from '../../../kit/components/primitives'

// Settings → Nodes is already an owner-authenticated client. It asks the selected Node for a
// one-time code and shows that Node's pinned identity beside it for the other client to compare.
export default function NodePairingCode(props: { node: NodeRecord }) {
  const [pairing, setPairing] = createSignal<PairingWindow | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let expiryTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(expiryTimer))

  const open = async () => {
    setBusy(true)
    setError('')
    setPairing(null)
    clearTimeout(expiryTimer)
    try {
      const opened = await openNodePairingWindow(props.node.nodeId)
      setPairing(opened)
      expiryTimer = setTimeout(() => setPairing(null), opened.expiresInMs)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    setBusy(true)
    setError('')
    try {
      await closeNodePairingWindow(props.node.nodeId)
      clearTimeout(expiryTimer)
      setPairing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="node-pairing">
      <Button disabled={busy()} onPress={() => void open()}>
        {pairing() ? 'New pairing code' : 'Pair another client'}
      </Button>
      <Show when={pairing()}>
        {(active) => (
          <div class="node-pairing-code">
            <p>Enter this code in the other client within {Math.ceil(active().expiresInMs / 60_000)} minutes.</p>
            <code>{active().code}</code>
            <Show when={fingerprintPhrase(props.node.fingerprint)}>
              {(words) => (
                <p>Check that its identity words match: <span class="node-fingerprint-words">{words()}</span></p>
              )}
            </Show>
            <Button disabled={busy()} onPress={() => void close()}>Close pairing</Button>
          </div>
        )}
      </Show>
      <Show when={error()}><Alert>{error()}</Alert></Show>
    </div>
  )
}
