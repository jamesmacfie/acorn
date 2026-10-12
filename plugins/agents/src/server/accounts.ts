import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isAccountName } from '../shared/accounts'

export const agentAccountsRoot = (dataDir: string): string => join(dataDir, 'agent-accounts')

/**
 * The extra logins on this Node, one folder each under `<data root>/agent-accounts/<harness>/<name>`
 * (docs/managed-agents/accounts.md). The folders are the record: nothing else lists them, so an
 * account exists exactly when its folder does. The harness's own default login lives wherever its CLI
 * keeps it and never appears here.
 */
export class AgentAccounts {
  constructor(private readonly root: string) {}

  /** The folder a harness's CLI is pointed at for this account. */
  home(providerId: string, name: string): string {
    if (!isAccountName(name)) throw new Error(`'${name}' is not a valid account name.`)
    return join(this.root, providerId, name)
  }

  async list(providerId: string): Promise<string[]> {
    const entries = await readdir(join(this.root, providerId), { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isDirectory() && isAccountName(entry.name))
      .map((entry) => entry.name)
      .sort()
  }

  async has(providerId: string, name: string): Promise<boolean> {
    return isAccountName(name) && (await this.list(providerId)).includes(name)
  }

  async create(providerId: string, name: string): Promise<string> {
    const home = this.home(providerId, name)
    if (await this.has(providerId, name)) throw new Error(`An account called '${name}' already exists.`)
    // Owner-only, because the CLI may write its login token here.
    await mkdir(home, { recursive: true, mode: 0o700 })
    return home
  }

  async remove(providerId: string, name: string): Promise<void> {
    await rm(this.home(providerId, name), { recursive: true, force: true })
  }

  /** The account a new session of this harness starts on when it names none, or null for the CLI's own
   *  login. Kept beside the folders, so removing the account's folder retires it too. */
  async defaultAccount(providerId: string): Promise<string | null> {
    const name = (await readFile(this.defaultFile(providerId), 'utf8').catch(() => '')).trim()
    return (await this.has(providerId, name)) ? name : null
  }

  async setDefaultAccount(providerId: string, name: string | null): Promise<void> {
    if (name === null) return rm(this.defaultFile(providerId), { force: true })
    if (!(await this.has(providerId, name))) throw new Error(`The '${name}' account was not found.`)
    await writeFile(this.defaultFile(providerId), `${name}\n`)
  }

  // A dot name, so `list` never reads it as an account.
  private defaultFile(providerId: string): string {
    return join(this.root, providerId, '.default')
  }
}
