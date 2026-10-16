import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRow } from '../projects/projects'
import { projectRepository } from '../projects/projects'
import { claimCodeHost, codeHostFor, codeHostLabel, declareCodeHost, heldHosts, runningCodeHosts } from './codeHosts'

const github = { label: 'GitHub', hosts: ['github.com'] }

describe('the code host registry', () => {
  const undos: (() => void)[] = []
  afterEach(() => {
    undos.splice(0).forEach((undo) => undo())
    vi.restoreAllMocks()
  })
  const declare = (...args: Parameters<typeof declareCodeHost>) => undos.push(declareCodeHost(...args))

  it('keeps a host with the built-in that claims it, whichever registers first', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    declare('aaa-impostor', github, false)
    declare('github', github, true)
    expect(codeHostFor('github.com')).toBe('github')
    // A reload re-registers the built-in last, and it still holds the host.
    undos.splice(1).forEach((undo) => undo())
    declare('github', github, true)
    expect(codeHostFor('github.com')).toBe('github')
  })

  it('settles two loaded claims by plugin id, and releases a host when its plugin stops', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    declare('zeta', { label: 'Zeta', hosts: ['git.example.org'] }, false)
    declare('alpha', { label: 'Alpha', hosts: ['git.example.org'] }, false)
    expect(codeHostFor('git.example.org')).toBe('alpha')
    expect(runningCodeHosts().sort()).toEqual(['alpha', 'zeta'])
    undos.pop()!()
    expect(codeHostFor('git.example.org')).toBe('zeta')
    expect(codeHostFor('gitlab.com')).toBeNull()
    expect(runningCodeHosts()).toEqual(['zeta'])
  })

  it('names a running code host by its declared label, and nothing else', () => {
    declare('gitlab-test', { label: 'GitLab', hosts: ['gitlab.test'] }, false)
    expect(codeHostLabel('gitlab-test')).toBe('GitLab')
    expect(codeHostLabel('linear')).toBeNull()
    undos.pop()!()
    expect(codeHostLabel('gitlab-test')).toBeNull()
  })

  it('refuses a host that is not a bare lowercase name', () => {
    expect(() => declareCodeHost('bad', { label: 'Bad', hosts: ['https://GitHub.com'] }, true)).toThrow()
  })

  it('takes a claim only from a self-hosted code host, and only for a bare lowercase name', () => {
    declare('gitlab', { label: 'GitLab', hosts: ['gitlab.com'] }, true)
    expect(() => claimCodeHost('gitlab', 'gitlab.example.test')).toThrow(/doesn't declare selfHosted/)
    expect(() => claimCodeHost('linear', 'gitlab.example.test')).toThrow(/doesn't declare selfHosted/)
    declare('forge', { label: 'Forge', hosts: ['forge.example.org'], selfHosted: true }, false)
    expect(() => claimCodeHost('forge', 'https://Git.Example.test')).toThrow(/bare lowercase name/)
  })

  it("gives a claimed host's projects to the claimer, and leaves their stored provider when it lets go", () => {
    declare('gitlab', { label: 'GitLab', hosts: ['gitlab.com'], selfHosted: true }, true)
    const release = claimCodeHost('gitlab', 'gitlab.example.test')
    expect(codeHostFor('gitlab.example.test')).toBe('gitlab')
    expect(heldHosts('gitlab')).toEqual(['gitlab.com', 'gitlab.example.test'])
    const row = { repoHost: 'gitlab.example.test', repoPath: 'group/api', repoProvider: 'gitlab', repoExternalId: null }
    expect(projectRepository({ ...row, repoProvider: null } as ProjectRow)?.provider).toBe('gitlab')
    release()
    expect(codeHostFor('gitlab.example.test')).toBeNull()
    expect(heldHosts('gitlab')).toEqual(['gitlab.com'])
    expect(projectRepository(row as ProjectRow)?.provider).toBe('gitlab')
    // A second release is a no-op, and doesn't drop a newer claim of the same host.
    const again = claimCodeHost('gitlab', 'gitlab.example.test')
    release()
    expect(codeHostFor('gitlab.example.test')).toBe('gitlab')
    again()
  })

  it('keeps github.com with GitHub when a loaded plugin claims it, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    declare('github', github, true)
    declare('aaa-forge', { label: 'Forge', hosts: ['forge.example.org'], selfHosted: true }, false)
    claimCodeHost('aaa-forge', 'github.com')
    expect(codeHostFor('github.com')).toBe('github')
    expect(heldHosts('aaa-forge')).toEqual(['forge.example.org'])
    expect(warn.mock.calls.flat().join(' ')).toContain("'aaa-forge' claims github.com, which 'github' holds")
  })

  it('drops every claim with the declaration when the plugin stops', () => {
    declare('gitlab', { label: 'GitLab', hosts: ['gitlab.com'], selfHosted: true }, true)
    claimCodeHost('gitlab', 'gitlab.example.test')
    undos.pop()!()
    expect(codeHostFor('gitlab.example.test')).toBeNull()
    declare('gitlab', { label: 'GitLab', hosts: ['gitlab.com'], selfHosted: true }, true)
    expect(heldHosts('gitlab')).toEqual(['gitlab.com'])
  })
})
