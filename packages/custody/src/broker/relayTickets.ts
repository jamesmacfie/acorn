// Relay tickets for the Nodes a client reaches through its account (docs/relay.md § Tickets). A ticket
// says "this account may open a stream to that Node", lasts five minutes, and is kept in memory only.
// It's fetched when a stream is needed and about to be used up, so nothing here runs on a timer: a client
// with no relayed Node asks for nothing.

export type Ticket = { ticket: string; /** Epoch seconds. */ expiresAt: number }
export type FetchTicket = (nodeId: string) => Promise<Ticket>
// What a stream to a relayed Node presents when its address carries no credential: a ticket for the
// Node, in memory, from `RelayTickets`.
export type RelayTicketFor = (nodeId: string) => Promise<string>

// A ticket that has less than this left is replaced, so the relay never sees one that expires on the way.
const REFRESH_BEFORE_EXPIRY_SECONDS = 60

export class RelayTickets {
  readonly #held = new Map<string, Promise<Ticket>>()

  constructor(
    private readonly fetchTicket: FetchTicket,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // One request per Node at a time, so a burst of streams shares a ticket. A failure isn't kept, so the
  // next stream asks again.
  async ticket(nodeId: string): Promise<string> {
    const held = this.#held.get(nodeId)
    const current = held && (await held.catch(() => null))
    if (current && current.expiresAt - this.now() / 1000 > REFRESH_BEFORE_EXPIRY_SECONDS) return current.ticket
    // What was held is spent or failed. Replace it, unless another caller already did while this one waited.
    if (this.#held.get(nodeId) === held) {
      const next = this.fetchTicket(nodeId)
      this.#held.set(nodeId, next)
      next.catch(() => this.#held.get(nodeId) === next && this.#held.delete(nodeId))
    }
    return (await this.#held.get(nodeId)!).ticket
  }

  forget(): void {
    this.#held.clear()
  }
}
