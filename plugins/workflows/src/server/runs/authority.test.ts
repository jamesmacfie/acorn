import { describe, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { asAuthorityError, authorizeRepoWorkflow, WorkflowAuthorityError } from './authority'

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

describe('committed workflows in an untrusted project', () => {
  const core = (trusted: boolean) => {
    const assertConfigTrusted = vi.fn(async () => {})
    return {
      assertConfigTrusted,
      core: {
        tasks: { load: async () => ({ id: 'task-1', projectId: 'project-1' }) },
        projects: { byId: async () => ({ id: 'project-1', trusted }), assertConfigTrusted },
      } as unknown as Pick<CoreServices, 'tasks' | 'projects'>,
    }
  }

  it('refuses them as untrusted before the configuration review, and reviews them once trusted', async () => {
    const untrusted = core(false)
    await expect(authorizeRepoWorkflow(untrusted.core, 'task-1')).rejects.toMatchObject({
      name: 'WorkflowAuthorityError',
      reason: 'untrusted',
    })
    expect(untrusted.assertConfigTrusted).not.toHaveBeenCalled()
    const trusted = core(true)
    await authorizeRepoWorkflow(trusted.core, 'task-1')
    expect(trusted.assertConfigTrusted).toHaveBeenCalledWith('task-1')
  })
})
