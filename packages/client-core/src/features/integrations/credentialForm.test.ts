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

const submitWith = (failure: unknown): Promise<string> =>
  createRoot(async (dispose) => {
    rotate.mockRejectedValueOnce(failure)
    const form = createCredentialForm(() => PROVIDER, () => {}, () => 'conn-1')
    form.setValue('token', 'lin_api_key')
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

  // The reason this file exists. Anything outside the one known code used to read as one sentence
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
