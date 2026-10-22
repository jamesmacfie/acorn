import type { PairingAsk } from '@acorn/protocol/node.ts'
import { nodeAddress } from '@acorn/protocol/relay.ts'
import { askToPair, probeNode, type NodeProbe } from './nodePairing'
import type { RelayTicketFor } from './relayTickets'

// The listed Node did not present the certificate its account vouched for.
export class VouchedIdentityError extends Error {}

// Pairing with a Node an account lists (docs/plugins/node-providers.md § Node providers). The account
// vouched for the Node's fingerprint, so a certificate that matches it stands where the owner's
// comparison of identity words does, and one that doesn't pairs nothing. Then the ask goes out with the
// assertion that shows the asker is the Node's owner, and the Node's paired devices decide.
export async function askVouchedNode(
  vouched: { endpoint: string; fingerprint: string; assertion: string },
  deviceName: string,
  relayTicket: RelayTicketFor,
): Promise<{ probe: NodeProbe; ask: PairingAsk }> {
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
  return { probe, ask }
}
