import { assertionClaimsSchema } from '@acorn/protocol/account.ts'
import { verifyToken } from '@acorn/protocol/accountToken.ts'
import { readNodeRelay } from '../storage/nodeRelay'

// Who may raise a pairing ask from another computer (docs/api-reference/transport.md § Pairing by
// approval): the Node's owner account, shown by an assertion the account service signed for this Node.
// Loaded on the first such ask, so a Node nobody asks from afar never carries it.
//
// An assertion grants nothing beyond raising the ask. It isn't a principal, and the device check the
// answer needs is untouched.
export async function ownerAssertion(
  assertion: string | undefined,
  node: { NODE_ID: string; DATA_DIR: string },
): Promise<{ accountId: string; assertionId: string } | null> {
  const { owner } = readNodeRelay(node.DATA_DIR)
  if (!assertion || !owner) return null
  const claims = await verifyToken(assertion, 'assertion', assertionClaimsSchema, owner.keys)
  return claims && claims.aud === node.NODE_ID && claims.sub === owner.accountId
    ? { accountId: claims.sub, assertionId: claims.jti }
    : null
}
