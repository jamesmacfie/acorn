import { describe, expect, it } from 'vitest'
import { withAccountHome } from './accountEnv'

const accounts = { env: 'CLAUDE_CONFIG_DIR', login: [], logout: [], overrides: ['CLAUDE_CODE_OAUTH_TOKEN'] }

describe('withAccountHome', () => {
  it("points the CLI at the account's folder and drops a token that would override its login", () => {
    const env = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/node/own', CLAUDE_CODE_OAUTH_TOKEN: 'node-token' }
    expect(withAccountHome(env, accounts, '/accounts/claude/work')).toEqual({
      PATH: '/bin',
      CLAUDE_CONFIG_DIR: '/accounts/claude/work',
    })
  })

  it('leaves the default login alone, and refuses an account on a harness without any', () => {
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'node-token' }
    expect(withAccountHome(env, accounts, undefined)).toBe(env)
    expect(() => withAccountHome(env, undefined, '/accounts/x/work')).toThrow(/second account/)
  })
})
