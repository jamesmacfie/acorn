import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeHostFor, declareCodeHost } from './codeHosts'

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
    undos.pop()!()
    expect(codeHostFor('git.example.org')).toBe('zeta')
    expect(codeHostFor('gitlab.com')).toBeNull()
  })

  it('refuses a host that is not a bare lowercase name', () => {
    expect(() => declareCodeHost('bad', { label: 'Bad', hosts: ['https://GitHub.com'] }, true)).toThrow()
  })
})
