import { describe, expect, it } from 'vitest'
import { oauthAppSettingsUrl } from './auth'

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
