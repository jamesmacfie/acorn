import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activeIdentityStore } from './activeIdentity'

describe('activeIdentityStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-identity-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists one explicit identity with private permissions', () => {
    const store = activeIdentityStore(dir)
    expect(store.get()).toBeNull()
    store.set('octocat')

    expect(activeIdentityStore(dir).get()).toBe('octocat')
    expect(readFileSync(join(dir, 'active-identity'), 'utf8')).toBe('octocat\n')
    expect(statSync(join(dir, 'active-identity')).mode & 0o777).toBe(0o600)
  })

  it('clears only the identity the caller authenticated as', () => {
    const store = activeIdentityStore(dir)
    store.set('octocat')
    store.clear('someone-else')
    expect(store.get()).toBe('octocat')
    store.clear('octocat')
    expect(store.get()).toBeNull()
  })
})
