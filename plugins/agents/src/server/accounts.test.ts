import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentAccounts } from './accounts'

describe('agent accounts', () => {
  let root: string
  let accounts: AgentAccounts

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'acorn-accounts-'))
    accounts = new AgentAccounts(root)
  })

  afterEach(() => rm(root, { recursive: true, force: true }))

  it('keeps one owner-only folder per account, listed by name', async () => {
    const home = await accounts.create('claude', 'work')
    await accounts.create('claude', 'personal')
    expect(home).toBe(join(root, 'claude', 'work'))
    expect((await stat(home)).mode & 0o777).toBe(0o700)
    expect(await accounts.list('claude')).toEqual(['personal', 'work'])
    expect(await accounts.list('codex')).toEqual([])
    await expect(accounts.create('claude', 'work')).rejects.toThrow(/already exists/)
    await accounts.remove('claude', 'work')
    expect(await accounts.list('claude')).toEqual(['personal'])
  })

  it('keeps a default account only while its folder exists', async () => {
    await accounts.create('claude', 'work')
    expect(await accounts.defaultAccount('claude')).toBeNull()
    await expect(accounts.setDefaultAccount('claude', 'gone')).rejects.toThrow(/not found/)
    await accounts.setDefaultAccount('claude', 'work')
    expect(await accounts.defaultAccount('claude')).toBe('work')
    expect(await accounts.list('claude')).toEqual(['work'])
    await accounts.remove('claude', 'work')
    expect(await accounts.defaultAccount('claude')).toBeNull()
  })

  it('refuses a name that could leave its folder or break a shell line', () => {
    for (const name of ['../x', 'Work', "it's", '', '-x']) expect(() => accounts.home('claude', name)).toThrow()
  })
})
