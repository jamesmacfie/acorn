import { describe, expect, it, vi } from 'vitest'
import { RelayTickets, type Ticket } from './relayTickets'

describe('relay tickets', () => {
  const issued = (id: string, now: number): Ticket => ({ ticket: id, expiresAt: now / 1000 + 300 })

  it('asks once for a burst of streams to one Node', async () => {
    const fetchTicket = vi.fn(async () => issued('first', 0))
    const tickets = new RelayTickets(fetchTicket, () => 0)
    expect(await Promise.all([tickets.ticket('a'), tickets.ticket('a'), tickets.ticket('a')])).toEqual([
      'first',
      'first',
      'first',
    ])
    expect(fetchTicket).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate ticket for each Node', async () => {
    const fetchTicket = vi.fn(async (nodeId: string) => issued(nodeId, 0))
    const tickets = new RelayTickets(fetchTicket, () => 0)
    expect([await tickets.ticket('a'), await tickets.ticket('b')]).toEqual(['a', 'b'])
  })

  it('reuses a ticket until a minute before it expires, then replaces it', async () => {
    let clock = 0
    let count = 0
    const fetchTicket = vi.fn(async () => issued(`ticket-${++count}`, clock))
    const tickets = new RelayTickets(fetchTicket, () => clock)
    expect(await tickets.ticket('a')).toBe('ticket-1')
    clock = 239_000 // 61 seconds left
    expect(await tickets.ticket('a')).toBe('ticket-1')
    clock = 241_000 // 59 seconds left
    expect(await tickets.ticket('a')).toBe('ticket-2')
    expect(fetchTicket).toHaveBeenCalledTimes(2)
  })

  it('asks again after a failure instead of keeping it', async () => {
    const fetchTicket = vi
      .fn<(nodeId: string) => Promise<Ticket>>()
      .mockRejectedValueOnce(new Error('signed out'))
      .mockResolvedValueOnce(issued('second', 0))
    const tickets = new RelayTickets(fetchTicket, () => 0)
    await expect(tickets.ticket('a')).rejects.toThrow('signed out')
    expect(await tickets.ticket('a')).toBe('second')
  })

  it('forgets every ticket on request', async () => {
    let count = 0
    const tickets = new RelayTickets(
      async () => issued(`ticket-${++count}`, 0),
      () => 0,
    )
    await tickets.ticket('a')
    tickets.forget()
    expect(await tickets.ticket('a')).toBe('ticket-2')
  })
})
