import { lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isAccountName } from '../shared/accounts'
import type { HarnessAccounts } from './drivers/types'

export type AccountShowAs = 'name' | 'icon'

/** What the person calls an account and the icon they gave it. The folder keeps the name it was made
 *  with, because the CLI finds its login and its sessions by the folder's path. */
export type AccountDetails = { label?: string; icon?: string }

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
    // Rewrites the details file without this account, so a later account of the same name starts
    // without its display name and icon.
    await writeFile(this.detailsFile(providerId), JSON.stringify(await this.details(providerId)))
  }

  /** The account a new session of this harness starts on when it names none: the chosen one, else the
   *  first by name. Null only when the harness has no accounts, which leaves the CLI's own login. Once
   *  the person has named their logins, the unnamed one is never picked for them. The choice is kept
   *  beside the folders, so removing the account's folder retires it too. */
  async defaultAccount(providerId: string): Promise<string | null> {
    const names = await this.list(providerId)
    const chosen = (await readFile(this.defaultFile(providerId), 'utf8').catch(() => '')).trim()
    return names.includes(chosen) ? chosen : (names[0] ?? null)
  }

  async setDefaultAccount(providerId: string, name: string | null): Promise<void> {
    if (name === null) return rm(this.defaultFile(providerId), { force: true })
    if (!(await this.has(providerId, name))) throw new Error(`The '${name}' account was not found.`)
    await writeFile(this.defaultFile(providerId), `${name}\n`)
  }

  /** The display name and icon the person gave each of this harness's accounts. An account that's
   *  gone is left out. */
  async details(providerId: string): Promise<Record<string, AccountDetails>> {
    const names = await this.list(providerId)
    const saved: Record<string, AccountDetails | undefined> = await readFile(this.detailsFile(providerId), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => ({}))
    return Object.fromEntries(
      names.flatMap((name) => {
        const { label, icon } = saved[name] ?? {}
        const details = {
          ...(typeof label === 'string' ? { label } : {}),
          ...(typeof icon === 'string' ? { icon } : {}),
        }
        return Object.keys(details).length ? [[name, details]] : []
      }),
    )
  }

  /** Changes an account's display name or icon. Null clears one, and absent leaves it. */
  async setDetails(
    providerId: string,
    name: string,
    change: { [Key in keyof AccountDetails]?: string | null },
  ): Promise<void> {
    if (!(await this.has(providerId, name))) throw new Error(`The '${name}' account was not found.`)
    const all = await this.details(providerId)
    const next: AccountDetails = { ...all[name] }
    for (const key of ['label', 'icon'] as const) {
      const value = change[key]
      if (value === null) delete next[key]
      else if (value !== undefined) next[key] = value
    }
    all[name] = next
    await writeFile(this.detailsFile(providerId), JSON.stringify(all))
  }

  /** Whether surfaces name accounts or draw their icons. One choice for every harness. */
  async showAs(): Promise<AccountShowAs> {
    const saved = await readFile(join(this.root, '.show-as'), 'utf8').catch(() => '')
    return saved.trim() === 'icon' ? 'icon' : 'name'
  }

  async setShowAs(show: AccountShowAs): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeFile(join(this.root, '.show-as'), `${show}\n`)
  }

  // Dot names, so `list` never reads them as accounts.
  private defaultFile(providerId: string): string {
    return join(this.root, providerId, '.default')
  }

  private detailsFile(providerId: string): string {
    return join(this.root, providerId, '.accounts.json')
  }
}

/**
 * Links each of the person's own skills into an account's folder, so every account has the ones the
 * default login has, and drops a link whose skill they've since removed. Anything else in the folder
 * stays: a skill added to that account alone, or one the CLI keeps per login. Run before every start,
 * so a skill added since the last one shows up.
 */
export async function linkSharedSkills(home: string, skills: NonNullable<HarnessAccounts['skills']>): Promise<void> {
  const from = skills.shared()
  const into = join(home, skills.folder)
  const shared = (await readdir(from).catch(() => [])).filter(
    (name) => !name.startsWith('.') && !skills.own.includes(name),
  )
  await mkdir(into, { recursive: true })
  const present = await readdir(into)
  for (const name of present) {
    if (shared.includes(name)) continue
    const target = await readlink(join(into, name)).catch(() => null)
    if (target === join(from, name)) await rm(join(into, name), { force: true })
  }
  for (const name of shared) {
    if (present.includes(name)) continue
    await symlink(join(from, name), join(into, name)).catch(ignoreExisting)
  }
}

/**
 * Links the person's settings file into an account that has none of its own, so the account starts
 * in the same permission mode, with the same model and hooks, as the default login. A file the account
 * already has, or a link the person pointed elsewhere, stays. The link goes when the default file
 * does, so the CLI never reads a dangling one. Run before every start, like `linkSharedSkills`.
 */
export async function linkSharedSettings(
  home: string,
  settings: NonNullable<HarnessAccounts['settings']>,
): Promise<void> {
  const from = settings.shared()
  const into = join(home, settings.file)
  const shared = await stat(from).then(
    (entry) => entry.isFile(),
    () => false,
  )
  const present = await lstat(into).then(
    () => true,
    () => false,
  )
  if (!present) {
    if (shared) await symlink(from, into).catch(ignoreExisting)
    return
  }
  if (!shared && (await readlink(into).catch(() => null)) === from) await rm(into, { force: true })
}

// Two sessions on one account can start at once, and the other may have made the link first.
function ignoreExisting(error: NodeJS.ErrnoException): void {
  if (error.code !== 'EEXIST') throw error
}
