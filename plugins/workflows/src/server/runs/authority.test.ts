import { describe, expect, it } from 'vitest'
import { asAuthorityError, WorkflowAuthorityError } from './authority'

describe('authority refusals', () => {
  it('types the refusals only the owner can fix by their code, and passes every other failure through', () => {
    const coded = (code: string) => Object.assign(new Error(`${code}: input github`), { code })
    for (const code of ['forbidden', 'connection-required', 'input-required'])
      expect(asAuthorityError(coded(code))).toMatchObject({ reason: code, message: `${code}: input github` })
    expect(asAuthorityError(Object.assign(new Error('Repo configuration'), { code: 'needs-trust' }))).toMatchObject({
      reason: 'untrusted',
    })
    for (const passing of [coded('rate-limited'), coded('unavailable'), new Error('connection-required')])
      expect(asAuthorityError(passing)).toBe(passing)
    const typed = new WorkflowAuthorityError('missing', 'That project no longer exists.')
    expect(asAuthorityError(typed)).toBe(typed)
  })
})
