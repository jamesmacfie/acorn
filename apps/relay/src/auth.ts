import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import {
  accountKeysSchema,
  accountPaths,
  credentialClaimsSchema,
  revokedCredentialsSchema,
  ticketClaimsSchema,
  type AccountKeys,
} from '@acorn/protocol/account.ts'
import { verifyToken } from '@acorn/protocol/accountToken.ts'

// Who may use a relay (docs/relay/accounts.md § Who may connect). A relay either holds one static
// credential that its Nodes and clients share, or checks what an account service signed.

// What a Node's credential proves. In account mode it names the account that owns the Node, and the
// credential's ID, which the account service can revoke.
export type NodeGrant = { owner?: string; credentialId?: string }
// What a client's ticket proves. In account mode it names the account that may open streams.
type ClientGrant = { account?: string }

export type RelayAuth = {
  node(request: IncomingMessage, route: string): Promise<NodeGrant | null>
  client(request: IncomingMessage, route: string): Promise<ClientGrant | null>
  /** Calls `onRevoked` with each credential ID the account service revokes. */
  watch?(onRevoked: (credentialId: string) => void): void
  /** Stops whatever `watch` started. */
  close?(): void
}

const bearer = (request: IncomingMessage): string => request.headers.authorization?.replace(/^Bearer /, '') ?? ''

export function staticAuth(credential: string): RelayAuth {
  const expected = Buffer.from(credential)
  const check = async (request: IncomingMessage): Promise<{} | null> => {
    const presented = Buffer.from(bearer(request))
    return presented.length === expected.length && timingSafeEqual(presented, expected) ? {} : null
  }
  return { node: check, client: check }
}

export type AccountAuthOptions = {
  /** The account service's base URL. */
  url: string
  /** How often to ask which credentials were revoked. */
  revocationPollMs?: number
  log?: (line: string) => void
}

const KEY_REFRESH_MIN_MS = 10_000

// The account service's public keys decide who gets in, with nothing else to share: a Node presents
// its relay credential and a client presents a ticket, and the relay checks the signature and the
// Node ID. Revoked credentials come from the account service's list, so removing a Node on the website
// drops it from the relay within a poll.
export async function accountAuth(options: AccountAuthOptions): Promise<RelayAuth> {
  const log = options.log ?? (() => {})
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(new URL(path, options.url))
    if (!response.ok) throw new Error(`The account service answered ${response.status} for ${path}.`)
    return response.json()
  }
  let keys: AccountKeys = accountKeysSchema.parse(await get(accountPaths.keys))
  let keysFetchedAt = Date.now()
  const revoked = new Set<string>()
  const listeners = new Set<(credentialId: string) => void>()

  // A token signed by a key this relay hasn't seen means the service rotated its keys, so ask again,
  // but never more than once in a while: a stranger's forged token must not make the relay fetch.
  const verified = async <Claims>(
    verifyWith: (keys: AccountKeys) => Promise<Claims | null>,
  ): Promise<Claims | null> => {
    const claims = await verifyWith(keys)
    if (claims || Date.now() - keysFetchedAt < KEY_REFRESH_MIN_MS) return claims
    keysFetchedAt = Date.now()
    keys = await get(accountPaths.keys).then(
      (body) => accountKeysSchema.parse(body),
      () => keys,
    )
    return verifyWith(keys)
  }

  const poll = async (): Promise<void> => {
    try {
      const { credentials } = revokedCredentialsSchema.parse(await get(accountPaths.revoked))
      for (const id of credentials) {
        if (revoked.has(id)) continue
        revoked.add(id)
        for (const listener of listeners) listener(id)
      }
    } catch (error) {
      log(`couldn't read the revoked credentials: ${error instanceof Error ? error.message : error}`)
    }
  }
  await poll()
  const timer = setInterval(() => void poll(), options.revocationPollMs ?? 10_000)
  timer.unref()

  return {
    async node(request, route) {
      const claims = await verified((current) =>
        verifyToken(bearer(request), 'credential', credentialClaimsSchema, current),
      )
      if (!claims || claims.node !== route || revoked.has(claims.jti)) return null
      return { owner: claims.sub, credentialId: claims.jti }
    },
    async client(request, route) {
      const claims = await verified((current) => verifyToken(bearer(request), 'ticket', ticketClaimsSchema, current))
      return claims?.node === route ? { account: claims.sub } : null
    },
    watch: (onRevoked) => void listeners.add(onRevoked),
    close: () => clearInterval(timer),
  }
}
