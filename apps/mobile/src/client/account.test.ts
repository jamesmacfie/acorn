import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountError, fetchAccount, fetchAssertion, fetchTicket, listAccountNodes, signInUrl } from './account'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const NODE_ID = '7f3c9c1e-5b2a-4d1e-9f77-2a5c8d0b1e44'

describe('the account service as a phone calls it', () => {
  it('sends the session cookie and the header only a page of the service’s own sends', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'acct_1', name: 'james' }))
    expect(await fetchAccount()).toEqual({ id: 'acct_1', name: 'james' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/account/v1/account',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
        headers: expect.objectContaining({ 'x-acorn-account': '1' }),
      }),
    )
  })

  it('lists the Nodes with the key each registered', async () => {
    const node = {
      nodeId: NODE_ID,
      label: 'Studio',
      fingerprint: 'ab'.repeat(32),
      channelKey: 'cd'.repeat(32),
      relayUrl: 'wss://relay.test',
    }
    fetchMock.mockResolvedValue(json(200, { nodes: [node] }))
    expect(await listAccountNodes()).toEqual([node])
  })

  it('asks for a ticket and an assertion for one Node', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ticket: 't.t.t', expiresAt: 1, relayUrl: 'wss://relay.test' }))
    expect((await fetchTicket(NODE_ID)).ticket).toBe('t.t.t')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ nodeId: NODE_ID }) })
    fetchMock.mockResolvedValueOnce(json(200, { assertion: 'a.a.a', expiresAt: 1 }))
    expect(await fetchAssertion(NODE_ID)).toBe('a.a.a')
  })

  it('knows a signed-out person from an account it can’t reach', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'invalid_token' }))
    const signedOut = await fetchAccount().catch((error: AccountError) => error)
    expect(signedOut).toMatchObject({ status: 401, code: 'invalid_token', signedOut: true })

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await fetchAccount().catch((error: AccountError) => error)).toMatchObject({
      status: 0,
      code: 'unavailable',
      signedOut: false,
    })

    // A host that isn't an account service at all.
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 404 }))
    expect(await fetchAccount().catch((error: AccountError) => error)).toMatchObject({ code: 'unavailable' })
  })

  it('refuses an answer that isn’t the API’s', async () => {
    fetchMock.mockResolvedValue(json(200, { nodes: 'none' }))
    await expect(listAccountNodes()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('sends the browser to the service’s sign-in page and back to where it was', () => {
    expect(signInUrl('/t/task-1')).toBe('/account/v1/browser/sign-in?next=%2Ft%2Ftask-1')
  })
})
