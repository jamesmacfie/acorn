import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHarness, type Harness } from './harness'

describe('core integration endpoints', () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(() => h.cleanup())

  it('lists the provider catalog + the synthesized GitHub connection', async () => {
    const res = await h.request('/api/v1/integrations', {}, h.readToken)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(Array.isArray(data.providers)).toBe(true)
    expect(data.integrations.some((i: { id: string }) => i.id === 'github')).toBe(true)
    // credentials/secrets never appear
    expect(JSON.stringify(data)).not.toContain('authRef')
  })

  it('requires write scope to connect', async () => {
    const res = await h.request('/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'i1' },
      body: JSON.stringify({ providerId: 'linear', credentials: { apiKey: 'x' } }),
    }, h.readToken)
    expect(res.status).toBe(403)
  })

  it('maps an unknown/unconnectable provider to a provider validation error', async () => {
    const res = await h.request('/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'i2' },
      body: JSON.stringify({ providerId: 'does-not-exist', credentials: {} }),
    }, h.writeToken)
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('provider_validation_failed')
  })
})
