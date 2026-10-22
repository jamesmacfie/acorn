import { describe, expect, it, vi } from 'vitest'
import { RelayTickets, type Ticket } from './relayTickets'

const relay = (route: string, url = 'wss://relay.example.com') => ({ route, url })

describe('relay tickets', () => {
  const issued = (id: string, now: number): Ticket => ({
    ticket: id,
    expiresAt: now / 1000 + 300,
    relayUrl: 'wss://relay.example.com/',
  })

  it('asks once for a burst of streams to one Node', async () => {
    const fetchTicket = vi.fn(async () => issued('first', 0))
    const tickets = new RelayTickets(fetchTicket, () => 0)
    const burst = await Promise.all([
      tickets.ticket(relay('a')),
      tickets.ticket(relay('a')),
      tickets.ticket(relay('a')),
    ])
    expect(burst).toEqual(['first', 'first', 'first'])
    expect(fetchTicket).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate ticket for each Node', async () => {
    const fetchTicket = vi.fn(async (nodeId: string) => issued(nodeId, 0))
    const tickets = new RelayTickets(fetchTicket, () => 0)
    expect([await tickets.ticket(relay('a')), await tickets.ticket(relay('b'))]).toEqual(['a', 'b'])
  })

  it('reuses a ticket until a minute before it expires, then replaces it', async () => {
    let clock = 0
    let count = 0
    const fetchTicket = vi.fn(async () => issued(`ticket-${++count}`, clock))
    const tickets = new RelayTickets(fetchTicket, () => clock)
    expect(await tickets.ticket(relay('a'))).toBe('ticket-1')
    clock = 239_000 // 61 seconds left
    expect(await tickets.ticket(relay('a'))).toBe('ticket-1')
    clock = 241_000 // 59 seconds left
    expect(await tickets.ticket(relay('a'))).toBe('ticket-2')
    expect(fetchTicket).toHaveBeenCalledTimes(2)
  })

  it('asks again after a failure instead of keeping it', async () => {
    const fetchTicket = vi
      .fn<(nodeId: string) => Promise<Ticket>>()
      .mockRejectedValueOnce(new Error('signed out'))
      .mockResolvedValueOnce(issued('second', 0))
    const tickets = new RelayTickets(fetchTicket, () => 0)
    await expect(tickets.ticket(relay('a'))).rejects.toThrow('signed out')
    expect(await tickets.ticket(relay('a'))).toBe('second')
  })

  it('forgets every ticket on request', async () => {
    let count = 0
    const tickets = new RelayTickets(
      async () => issued(`ticket-${++count}`, 0),
      () => 0,
    )
    await tickets.ticket(relay('a'))
    tickets.forget()
    expect(await tickets.ticket(relay('a'))).toBe('ticket-2')
  })

  it('refuses to hand a ticket to a relay the account does not name for the Node', async () => {
    const tickets = new RelayTickets(
      async () => issued('ticket', 0),
      () => 0,
    )
    await expect(tickets.ticket(relay('a', 'wss://elsewhere.example.net'))).rejects.toThrow(
      'relay.example.com, not elsewhere.example.net',
    )
  })
})
