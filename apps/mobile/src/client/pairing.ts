import type { ChannelClient } from '@acorn/channel/client.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { PairResult, PairingAsk } from '@acorn/protocol/node.ts'
import type { AccountNode } from '@acorn/protocol/account.ts'
import { fetchAssertion } from './account'
import { openNodeChannel } from './openChannel'
import { savePaired, type PairedNode } from './pairedNodes'

// Pairing this phone with one of the account's Nodes (docs/relay/phone-channel.md § Pair a phone). The
// Node's own pairing by approval does the work: this phone asks, with an account assertion that says the
// person is signed in as the Node's owner, and a device that is already paired shows the same three
// words and an Allow button. The key the phone pins is the one the account listed for the Node, kept from
// here on.

const POLL_MS = 1_500
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type Pairing = {
  /** The three words, shown on this phone and on the device that is asked to allow it. */
  phrase: string
  /** Resolves once a paired device allowed it. Rejects when it was denied or ran out. */
  paired: Promise<PairedNode>
  cancel(): void
}

const post = (client: ChannelClient, path: string, body: unknown) =>
  client.request({
    method: 'POST',
    path,
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify(body)),
  })

const refusal = (status: number): string =>
  status === 403
    ? 'This Node only takes a pairing request from the account that owns it. Sign in with that account.'
    : status === 429
      ? 'Too many pairing requests. Try again in a minute.'
      : status === 409
        ? 'Another device asked at the same moment. Try again.'
        : `The Node refused the request (${status}).`

/** The name this phone gives itself, which the Node lists and the approving device shows. */
export function phoneName(userAgent = navigator.userAgent): string {
  const device = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : 'Phone'
  const browser = /Firefox|FxiOS/.test(userAgent)
    ? 'Firefox'
    : /Edg/.test(userAgent)
      ? 'Edge'
      : /Chrome|CriOS/.test(userAgent)
        ? 'Chrome'
        : /Safari/.test(userAgent)
          ? 'Safari'
          : 'browser'
  // So two phones of one kind can be told apart in the Node's device list and audit log.
  const tag = crypto
    .getRandomValues(new Uint8Array(2))
    .reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '')
  return `${device} ${browser} ${tag}`
}

export async function pairWithNode(node: AccountNode, deviceName = phoneName()): Promise<Pairing> {
  if (!node.channelKey)
    throw new Error(
      'This Node registered before phones could pair with it. Turn Remote access off and on again in Acorn.',
    )
  const channelKey = node.channelKey
  const client = await openNodeChannel(node.nodeId, channelKey, { onFrame: () => {}, onBytes: () => {} })
  const abort = new AbortController()
  const cancel = () => {
    abort.abort()
    client.close()
  }
  try {
    const asked = await post(client, '/v1/pair/requests', { deviceName, assertion: await fetchAssertion(node.nodeId) })
    if (asked.status !== 200) throw new Error(refusal(asked.status))
    const ask = JSON.parse(decoder.decode(asked.body)) as PairingAsk
    const expires = Date.now() + ask.expiresInMs

    const paired = (async (): Promise<PairedNode> => {
      try {
        while (!abort.signal.aborted && Date.now() < expires + POLL_MS) {
          const claim = await post(client, '/v1/pair/requests/claim', { secret: ask.secret })
          if (claim.status === 200) {
            const result = JSON.parse(decoder.decode(claim.body)) as PairResult
            if (result.baseline !== ACORN_BASELINE)
              throw new Error('This Node speaks a version of Acorn this app doesn’t.')
            const stored = { nodeId: node.nodeId, label: node.label, channelKey, pairedAt: Date.now() }
            await savePaired(stored, result.deviceToken)
            return stored
          }
          if (claim.status !== 202) break
          await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        }
        throw new Error(
          abort.signal.aborted ? 'Cancelled.' : 'The request was denied, or it ran out of time. Try again.',
        )
      } finally {
        client.close()
      }
    })()
    return { phrase: ask.phrase, paired, cancel }
  } catch (error) {
    client.close()
    throw error
  }
}
