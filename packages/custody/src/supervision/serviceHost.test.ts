import { describe, expect, it } from 'vitest'
import { serviceEnvironment } from './serviceHost'

describe('the node service environment', () => {
  it('drops the named secrets always, and secret-shaped names only when a .env file supplied them', () => {
    const env = {
      PATH: '/usr/bin',
      SESSION_ENC_KEY: 'a'.repeat(64),
      INTERNAL_TOKEN: 'signing',
      GITHUB_CLIENT_SECRET: 'unused',
      GITHUB_CLIENT_ID: 'Iv1.public',
      SENTRY_AUTH_TOKEN: 'from-a-file',
      CODEX_API_KEY: 'from-the-launch-shell',
    }
    const fromEnvFiles = new Set(['SESSION_ENC_KEY', 'GITHUB_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'SENTRY_AUTH_TOKEN'])
    expect(serviceEnvironment(env, fromEnvFiles)).toEqual({
      PATH: '/usr/bin',
      GITHUB_CLIENT_ID: 'Iv1.public',
      CODEX_API_KEY: 'from-the-launch-shell',
    })
  })
})
