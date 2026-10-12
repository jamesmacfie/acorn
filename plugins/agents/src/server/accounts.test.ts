import { mkdir, mkdtemp, readdir, readlink, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentAccounts, linkSharedSkills } from './accounts'

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

  it('defaults to the chosen account, else the first, and to none only without accounts', async () => {
    expect(await accounts.defaultAccount('claude')).toBeNull()
    await accounts.create('claude', 'work')
    await accounts.create('claude', 'personal')
    expect(await accounts.defaultAccount('claude')).toBe('personal')
    await expect(accounts.setDefaultAccount('claude', 'gone')).rejects.toThrow(/not found/)
    await accounts.setDefaultAccount('claude', 'work')
    expect(await accounts.defaultAccount('claude')).toBe('work')
    expect(await accounts.list('claude')).toEqual(['personal', 'work'])
    await accounts.remove('claude', 'work')
    expect(await accounts.defaultAccount('claude')).toBe('personal')
  })

  it('refuses a name that could leave its folder or break a shell line', () => {
    for (const name of ['../x', 'Work', "it's", '', '-x']) expect(() => accounts.home('claude', name)).toThrow()
  })

  it("links the person's own skills into an account and keeps the account's own", async () => {
    const shared = join(root, 'default-skills')
    const skills = { shared: () => shared, folder: 'skills', own: ['synced'] }
    for (const name of ['planner', 'readable', 'synced', '.DS_Store'])
      await mkdir(join(shared, name), { recursive: true })
    const home = await accounts.create('claude', 'work')
    // The account's claude.ai skills, and a skill added to this account alone.
    await mkdir(join(home, 'skills', 'synced'), { recursive: true })
    await mkdir(join(home, 'skills', 'mine'))

    await linkSharedSkills(home, skills)
    expect((await readdir(join(home, 'skills'))).sort()).toEqual(['mine', 'planner', 'readable', 'synced'])
    expect(await readlink(join(home, 'skills', 'planner'))).toBe(join(shared, 'planner'))
    expect((await stat(join(home, 'skills', 'synced'))).isDirectory()).toBe(true)

    // A skill removed from the default login goes; a link the person made to somewhere else stays.
    await rm(join(shared, 'readable'), { recursive: true })
    await symlink(join(root, 'elsewhere'), join(home, 'skills', 'pointed'))
    await linkSharedSkills(home, skills)
    expect((await readdir(join(home, 'skills'))).sort()).toEqual(['mine', 'planner', 'pointed', 'synced'])
  })

  it('makes the skills folder in an account that has none yet, and runs again without complaint', async () => {
    const shared = join(root, 'default-skills')
    await mkdir(join(shared, 'planner'), { recursive: true })
    const home = await accounts.create('claude', 'work')
    const skills = { shared: () => shared, folder: 'skills', own: [] }
    await Promise.all([linkSharedSkills(home, skills), linkSharedSkills(home, skills)])
    expect(await readdir(join(home, 'skills'))).toEqual(['planner'])
  })
})
