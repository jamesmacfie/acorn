import { describe, expect, it } from 'vitest'
import { actionFailure, sayOnFailure } from './actionErrors'

// The client throws an error whose message is the route's code when the route sent no prose.
const coded = (code: string, message = code) => Object.assign(new Error(message), { code })

describe('a failed GitHub action', () => {
  it('says a sentence for each code family, and keeps the code', () => {
    expect(actionFailure(coded('merge_failed'))).toEqual({
      text: "GitHub wouldn't merge this pull request. Check its reviews and checks.",
      code: 'merge_failed',
    })
    expect(actionFailure(coded('reauth')).text).toBe("GitHub turned down acorn's sign-in. Reconnect GitHub.")
    expect(actionFailure(coded('rate_limited')).text).toBe('GitHub is limiting requests. Try again in a minute.')
    expect(actionFailure(coded('head_sha_unknown')).text).toContain("hasn't finished loading")
    expect(actionFailure(coded('sso')).text).toContain('single sign-on')
    expect(actionFailure(coded('something_new')).text).toBe("GitHub didn't accept that. Try again.")
  })

  it('keeps GitHub\'s own words when the route sent them', () => {
    expect(actionFailure(coded('merge_failed', 'Head branch was modified.')).text).toBe('Head branch was modified.')
    expect(actionFailure(new Error('409')).text).toBe("GitHub didn't accept that. Try again.")
  })

  it('says what failed for a write that has its own sentence', async () => {
    await expect(sayOnFailure(Promise.reject(coded('github_unavailable')), "Couldn't save your reply.")).rejects.toThrow("Couldn't save your reply.")
    await expect(sayOnFailure(Promise.reject(coded('forbidden', 'Not a collaborator.')), "Couldn't save your reply.")).rejects.toThrow('Not a collaborator.')
  })
})
