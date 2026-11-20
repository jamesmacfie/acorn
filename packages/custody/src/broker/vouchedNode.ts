import type { PairingAsk } from '@acorn/protocol/node.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { nodeAddress } from '@acorn/protocol/relay.ts'
import { askToPair, probeNode, type NodeProbe } from './nodePairing'
import type { RelayTicketFor } from './relayTickets'

// The listed Node did not present the certificate its account vouched for.
export class VouchedIdentityError extends Error {}

// Pairing with a Node an account lists (docs/plugins/node-providers.md § Node providers). A certificate
// that doesn't match the fingerprint the account vouched for pairs nothing. One that matches proves only
// that the endpoint is the account's choice, and a breached account could list a relay of its own that
// forwards the ask to the real Node. So `identity` is the words of the certificate this probe saw. The
// client shows them beside the phrase, and the owner's dialog shows the Node's own: a relay in between
// can't make the two agree.
export async function askVouchedNode(
  vouched: { endpoint: string; fingerprint: string; assertion: string },
  deviceName: string,
  relayTicket: RelayTicketFor,
): Promise<{ probe: NodeProbe; ask: PairingAsk; identity: string }> {
  const probe = await probeNode(vouched.endpoint, { relayTicket })
  if (probe.fingerprint !== vouched.fingerprint)
    throw new VouchedIdentityError(
      `${nodeAddress(probe)} presented a different identity than your account vouched for. Nothing was paired.`,
    )
  if (!probe.compatible) throw new Error('That node speaks a different protocol version.')
  const ask = await askToPair(probe, deviceName, vouched.assertion)
  if (!ask)
    throw new Error(
      'That Node would not take the request. Check that it is signed in to the same account with remote access on.',
    )
  return { probe, ask, identity: fingerprintPhrase(probe.fingerprint)! }
}
