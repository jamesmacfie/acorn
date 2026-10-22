import type { RelayRoute } from '@acorn/protocol/relay.ts'

// Relay tickets for the Nodes a client reaches through its account (docs/relay/accounts.md § Tickets). A
// ticket says "this account may open a stream to that Node", lasts five minutes, and is kept in memory
// only. It's fetched when a stream is needed and about to be used up, so nothing here runs on a timer: a
// client with no relayed Node asks for nothing.

export type Ticket = {
  ticket: string
  /** Epoch seconds. */
  expiresAt: number
  /** The relay the account service says the Node is on. */
  relayUrl: string
}
export type FetchTicket = (nodeId: string) => Promise<Ticket>
// What a stream to a relayed Node presents when its address carries no credential: a ticket for the
// Node, in memory, from `RelayTickets`.
export type RelayTicketFor = (relay: RelayRoute) => Promise<string>

// A ticket that has less than this left is replaced, so the relay never sees one that expires on the way.
const REFRESH_BEFORE_EXPIRY_SECONDS = 60

const sameRelay = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

export class RelayTickets {
  readonly #held = new Map<string, Promise<Ticket>>()

  constructor(
    private readonly fetchTicket: FetchTicket,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // A ticket for the Node, for the relay the address names. The ticket goes nowhere but to that relay, so
  // an address that names a relay other than the one the account service lists for the Node is refused.
  async ticket({ route, url }: RelayRoute): Promise<string> {
    const issued = await this.#issued(route)
    if (!sameRelay(issued.relayUrl, url))
      throw new Error(`Your account puts this Node on ${new URL(issued.relayUrl).host}, not ${new URL(url).host}.`)
    return issued.ticket
  }

  // One request per Node at a time, so a burst of streams shares a ticket. A failure isn't kept, so the
  // next stream asks again.
  async #issued(nodeId: string): Promise<Ticket> {
    const held = this.#held.get(nodeId)
    const current = held && (await held.catch(() => null))
    if (current && current.expiresAt - this.now() / 1000 > REFRESH_BEFORE_EXPIRY_SECONDS) return current
    // What was held is spent or failed. Replace it, unless another caller already did while this one waited.
    if (this.#held.get(nodeId) === held) {
      const next = this.fetchTicket(nodeId)
      this.#held.set(nodeId, next)
      next.catch(() => this.#held.get(nodeId) === next && this.#held.delete(nodeId))
    }
    return this.#held.get(nodeId)!
  }

  forget(): void {
    this.#held.clear()
  }
}
