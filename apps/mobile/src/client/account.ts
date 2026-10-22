import type { z } from 'zod'
import {
  ACCOUNT_BROWSER_HEADER,
  accountErrorSchema,
  accountPaths,
  accountSchema,
  assertionResponseSchema,
  listNodesResponseSchema,
  ticketResponseSchema,
  type Account,
  type AccountNode,
  type TicketResponse,
} from '@acorn/protocol/account.ts'

// The account service as the phone app calls it (docs/account-api.md § Browsers). The app is served by the
// account website, so the service is on its own origin and the person's session cookie goes with every
// call. The header is what tells the service a page of its own made the call.
//
// It imports nothing that reads the platform seam, because `main.tsx` installs the seam before the app
// loads.

/** What the service refused with, or `unavailable` when it didn't answer or isn't an account service. */
export class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(
      code === 'invalid_token'
        ? 'You’re signed out of your account.'
        : code === 'not_found'
          ? 'Your account doesn’t list that Node.'
          : 'Can’t reach your account.',
    )
  }
  /** The person has no session, or it ended. */
  get signedOut(): boolean {
    return this.code === 'invalid_token'
  }
}

async function call<Schema extends z.ZodType>(
  method: string,
  path: string,
  schema: Schema,
  body?: unknown,
): Promise<z.infer<Schema>> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { [ACCOUNT_BROWSER_HEADER]: '1', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new AccountError(0, 'unavailable')
  }
  const json: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const refusal = accountErrorSchema.safeParse(json)
    throw new AccountError(response.status, refusal.success ? refusal.data.error : 'unavailable')
  }
  const answer = schema.safeParse(json)
  if (!answer.success) throw new AccountError(response.status, 'unavailable')
  return answer.data
}

export const fetchAccount = (): Promise<Account> => call('GET', accountPaths.account, accountSchema)

export const listAccountNodes = async (): Promise<AccountNode[]> =>
  (await call('GET', accountPaths.nodes, listNodesResponseSchema)).nodes

export const fetchTicket = (nodeId: string): Promise<TicketResponse> =>
  call('POST', accountPaths.tickets, ticketResponseSchema, { nodeId })

export const fetchAssertion = async (nodeId: string): Promise<string> =>
  (await call('POST', accountPaths.assertions, assertionResponseSchema, { nodeId })).assertion

/** Where to send the browser to sign in, and have it come back to `next`. */
export const signInUrl = (next: string): string => `${accountPaths.browserSignIn}?next=${encodeURIComponent(next)}`
