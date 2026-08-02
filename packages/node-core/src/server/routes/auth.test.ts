import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { sealSession, SESSION_COOKIE } from '../session'
import { auth, oauthAppSettingsUrl } from './auth'
import type { Env } from '../../main/bindings'

const ENC_KEY = '0'.repeat(64)

describe('oauthAppSettingsUrl', () => {
  it('points at the authorized OAuth app settings page for the configured client id', () => {
    expect(oauthAppSettingsUrl(' Iv1.abc123 ')).toBe('https://github.com/settings/connections/applications/Iv1.abc123')
  })

  it('falls back to the applications settings page when no client id is configured', () => {
    expect(oauthAppSettingsUrl('')).toBe('https://github.com/settings/applications')
  })

  it('encodes the client id as a path segment', () => {
    expect(oauthAppSettingsUrl('client/id')).toBe('https://github.com/settings/connections/applications/client%2Fid')
  })
})

describe('logout credential lifecycle', () => {
  // The session cookie is now the only credential logout has to clear — the encrypted
  // oauth_accounts record went away with the /api/v1 surface that was its sole reason to exist.
  it('clears the active identity and the session cookie', async () => {
    const active = {
      get: vi.fn(() => 'octocat'),
      set: vi.fn(),
      clear: vi.fn(),
    }
    const sealed = await sealSession({ token: 'gho_secret', login: 'octocat', name: 'Octo', avatar: '', scopes: [] }, ENC_KEY)
    const app = new Hono<{ Bindings: Env }>().route('/auth', auth)
    const response = await app.fetch(
      new Request('http://acorn.test/auth/logout', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${sealed}` },
      }),
      {
        SESSION_ENC_KEY: ENC_KEY,
        ACTIVE_IDENTITY: active,
      } as unknown as Env,
    )

    expect(response.status).toBe(204)
    expect(active.clear).toHaveBeenCalledWith('octocat')
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`)
  })
})
