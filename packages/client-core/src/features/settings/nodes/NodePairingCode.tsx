import { createSignal, onCleanup, Show } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import type { PairingWindow } from '@acorn/protocol/node.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { closeNodePairingWindow, openNodePairingWindow } from '../../../infra/node/fleetActions'
import { Alert, Button, Card } from '../../../kit/components/primitives'
import CopyButton from '../../../kit/components/inputs/CopyButton'
import { Text } from '../../../kit/components/content/Text'
import { Stack } from '../../../kit/components/layout/Stack'

// Settings → Nodes is already an owner-authenticated client. It asks the selected Node for a
// one-time code and shows that Node's pinned identity beside it for the other client to compare.
//
// Three parts, because the buttons sit in the node's row of actions and the code opens under them:
// the state, the buttons, and the panel. Both buttons open the same pairing window; the browser one
// only words the code for the Acorn browser panel, which takes it by paste.

export type NodePairing = ReturnType<typeof createNodePairing>
type PairingFor = 'client' | 'extension'

export function createNodePairing(nodeId: () => string) {
  const [pairing, setPairing] = createSignal<(PairingWindow & { for: PairingFor }) | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let expiryTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(expiryTimer))

  const open = async (target: PairingFor) => {
    setBusy(true)
    setError('')
    setPairing(null)
    clearTimeout(expiryTimer)
    try {
      const opened = await openNodePairingWindow(nodeId())
      setPairing({ ...opened, for: target })
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
      await closeNodePairingWindow(nodeId())
      clearTimeout(expiryTimer)
      setPairing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return { pairing, busy, error, open, close }
}

export function NodePairingButtons(props: { pairing: NodePairing }) {
  const button = (target: PairingFor, label: string) => (
    <Button size="sm" disabled={props.pairing.busy()} onPress={() => void props.pairing.open(target)}>
      {props.pairing.pairing()?.for === target ? 'New pairing code' : label}
    </Button>
  )
  return (
    <>
      {button('client', 'Pair another client')}
      {button('extension', 'Pair a browser')}
    </>
  )
}

/** The open code, drawn the way Add connection draws a device code: large, in the code font, with a
 *  copy button, because it is read off this screen and typed on another. */
export function NodePairingPanel(props: { node: NodeRecord; pairing: NodePairing }) {
  return (
    <>
      <Show when={props.pairing.pairing()}>
        {(active) => (
          <Card>
            <div class="integration-device">
              <Text wrap>
                {active().for === 'extension'
                  ? 'Open the Acorn panel in your browser and paste this code'
                  : 'Enter this code on the other computer'}{' '}
                within {Math.ceil(active().expiresInMs / 60_000)} minutes.
              </Text>
              <div class="integration-device-code copyable">
                <code>{active().code}</code>
                <CopyButton text={() => active().code} title="Copy the code" always />
              </div>
              <Show when={fingerprintPhrase(props.node.fingerprint)}>
                {(words) => (
                  <Stack gap="inline">
                    <Text emphasis="muted" wrap>
                      Check that its identity words match:
                    </Text>
                    <span class="node-fingerprint-words">{words()}</span>
                  </Stack>
                )}
              </Show>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.pairing.busy()}
                onPress={() => void props.pairing.close()}
              >
                Close pairing
              </Button>
            </div>
          </Card>
        )}
      </Show>
      <Show when={props.pairing.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
    </>
  )
}
