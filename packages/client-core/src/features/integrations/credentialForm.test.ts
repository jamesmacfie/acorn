import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { ApiError } from '../../infra/node/apiClient'
import { createCredentialForm } from './credentialForm'

const rotate = vi.fn()
vi.mock('./integrationClient', () => ({
  connectIntegration: vi.fn(),
  rotateIntegration: (id: string, credentials: Record<string, string>) => rotate(id, credentials),
}))

const PROVIDER = {
  id: 'linear',
  label: 'Linear',
  connection: { fields: [{ id: 'token', label: 'Personal API key', type: 'password', required: true }] },
} as unknown as PublicIntegrationProvider

const submitValue = (entered: string): Promise<string> =>
  createRoot(async (dispose) => {
    rotate.mockClear()
    const form = createCredentialForm(() => PROVIDER, () => {}, () => 'conn-1')
    form.setValue('token', entered)
    await form.submit()
    const message = form.error()
    dispose()
    return message
  })

const submitWith = (failure: unknown): Promise<string> =>
  createRoot(async (dispose) => {
    rotate.mockRejectedValueOnce(failure)
    const form = createCredentialForm(() => PROVIDER, () => {}, () => 'conn-1')
    form.setValue('token', 'op://Vault/Item/credential')
    await form.submit()
    const message = form.error()
    dispose()
    return message
  })

// The failure branch, because it is the only part of this module a person ever reads. A code that
// stops matching turns a diagnosis back into "something went wrong", and nothing else would notice.
describe('createCredentialForm error copy', () => {
  it('names the provider when the provider refused the credential', async () => {
    expect(await submitWith(new ApiError('provider_needs_auth', 401, 'provider_needs_auth')))
      .toBe('Those credentials were rejected by Linear.')
  })

  it('points at the Security page when 1Password could not be read', async () => {
    expect(await submitWith(new ApiError('provider_secret_ref_unreadable', 502, 'provider_secret_ref_unreadable')))
      .toBe('Could not read that 1Password reference. Check Settings, Security, 1Password.')
  })

  // The reason this file exists. Anything outside the two known codes used to read as one sentence
  // with nothing in it to look up.
  it('carries the code and the request id for every other failure', async () => {
    const failure = new ApiError('provider_unavailable', 502, 'provider_unavailable', { requestId: 'r7-123' })
    expect(await submitWith(failure)).toBe('Could not connect this provider. (provider_unavailable · r7-123)')
  })

  // A route that passes `detail` to respondError sends prose in `message` and the code only in
  // `code`. Matching on the message would silently fall through to the generic sentence.
  it('branches on the code even when the envelope carries its own prose', async () => {
    const failure = new ApiError('Your workspace is over its seat limit.', 401, 'provider_needs_auth')
    expect(await submitWith(failure)).toBe('Those credentials were rejected by Linear.')
  })
})

// A 1Password item link and a secret reference come off the same right-click menu. Sending the link
// as the credential means the provider rejects it, which reads as "your key is bad" and sends the
// reader off to reissue a key that was fine.
describe('createCredentialForm 1Password link guard', () => {
  const LINK_MESSAGE =
    'That is a 1Password item link, not a secret reference. In 1Password, use Copy Secret Reference to get an op://Vault/Item/field value.'

  it.each([
    'https://start.1password.com/open/i?a=ACCT&v=VAULT&i=ITEM&h=team-runn.1password.com',
    'https://team-runn.1password.com/open/i?a=ACCT',
    'onepassword://open/i?a=ACCT',
  ])('refuses %s without calling the node', async (link) => {
    expect(await submitValue(link)).toBe(LINK_MESSAGE)
    expect(rotate).not.toHaveBeenCalled()
  })

  it('lets a secret reference through, because that is the shape that resolves', async () => {
    rotate.mockResolvedValueOnce({})
    expect(await submitValue('op://Vault/Item/credential')).toBe('')
    expect(rotate).toHaveBeenCalledWith('conn-1', { token: 'op://Vault/Item/credential' })
  })

  it('lets an ordinary key through', async () => {
    rotate.mockResolvedValueOnce({})
    expect(await submitValue('lin_api_realkey')).toBe('')
    expect(rotate).toHaveBeenCalledOnce()
  })
})
