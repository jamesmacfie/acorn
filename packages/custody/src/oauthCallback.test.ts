import { describe, expect, it } from 'vitest'
import { listenForOauthCallback } from './oauthCallback'

describe('the sign-in return trip listener', () => {
  it('answers only its own path, hands over the query, and never echoes it', async () => {
    const listener = await listenForOauthCallback()
    const url = new URL(listener.redirectUri)
    expect(url.hostname).toBe('127.0.0.1')
    expect((await fetch(new URL('/acorn-oauth/guess?code=x', url))).status).toBe(404)
    expect((await fetch(listener.redirectUri, { method: 'POST' })).status).toBe(404)

    const response = await fetch(`${listener.redirectUri}?code=secret-code&state=abc`)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('secret-code')
    const params = await listener.result
    expect(params.get('code')).toBe('secret-code')
    expect(params.get('state')).toBe('abc')
    // One request only: the port is closed after it.
    await expect(fetch(listener.redirectUri)).rejects.toThrow()
  })

  it('rejects when closed or when nobody comes back in time', async () => {
    const closed = await listenForOauthCallback()
    closed.close()
    await expect(closed.result).rejects.toThrow('closed')
    const late = await listenForOauthCallback(20)
    await expect(late.result).rejects.toThrow('ten minutes')
  })
})
