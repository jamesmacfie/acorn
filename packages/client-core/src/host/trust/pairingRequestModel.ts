import { createSignal, onCleanup } from 'solid-js'
import type { PairingDecision, PairingRequest } from '@acorn/protocol/node.ts'
import { toast } from '../../features/notifications/toast'
import { nodes } from '../../infra/node/fleet'
import { answerPairingRequest, readPairingRequest } from '../../infra/node/fleetActions'
import { wsOnFleetPairingRequested } from '../../infra/node/wsClient'

const ALLOW_DELAY_MS = 1_000

// The owner's side of pairing by approval (docs/api-reference/transport.md § Pairing by approval), for
// whichever client draws the dialog. Call it once, inside the component that does.
//
// It asks to open by itself when a paired Node says a client is asking. That is the point: whoever just
// started `acorn`, the browser extension, or Connect on another computer waits on this answer. The request
// is read from the Node's device-only route, never from the frame, which a task-scoped socket hears too.
//
// The phrase is the check. The asker shows the same three words, so a request something else raced in
// shows words the person doesn't recognize. The words on screen never change under the cursor: a frame
// that brings a different request, or none, closes the dialog instead of replacing what the person is
// reading. **Allow** also waits a second after the dialog opens, so a click meant for something else
// can't land on it.
export function createPairingRequests() {
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

  return { asking, busy, error, armed, answer, close }
}

const nodeLabel = (nodeId: string): string => nodes().find((node) => node.nodeId === nodeId)?.label ?? 'this Node'

/** Who is asking, and from where. An ask from another computer is the owner's own account, by its
 *  assertion, so the words say which computer it is not on. */
export function askerLine(asking: { nodeId: string; request: PairingRequest }): string {
  const { deviceName, remote } = asking.request
  const label = nodeLabel(asking.nodeId)
  return remote
    ? `${deviceName}, signed in to your account on another computer, is asking for full access to ${label}.`
    : `${deviceName} on the computer running ${label} is asking for full access to it.`
}

/** The last line of the dialog: when to say no. */
export const denyAdvice = (request: PairingRequest): string =>
  request.remote
    ? "If you didn't just click Connect on another computer, deny it."
    : "If you didn't just start the terminal app or the browser extension, deny it."
