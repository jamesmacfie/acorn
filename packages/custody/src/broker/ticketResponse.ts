import { ticketResponseSchema } from '@acorn/protocol/account.ts'
import type { Ticket } from './relayTickets'

// A ticket from the answer the local Node's account plugin gave, or the reason there isn't one.
export function ticketResponse(status: number, body: Uint8Array): Ticket {
  if (status === 401) throw new Error('Sign in to your acorn account in Settings → Account to reach this Node.')
  if (status === 404) throw new Error('Your acorn account doesn’t have that Node.')
  const parsed = ticketResponseSchema.safeParse(status === 200 ? JSON.parse(new TextDecoder().decode(body)) : null)
  if (!parsed.success) throw new Error('This computer’s Node couldn’t get a relay ticket from your account.')
  return parsed.data
}
