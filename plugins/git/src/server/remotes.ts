import { isAbsolute, resolve } from 'node:path'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { RemoteChange, RemoteChangeResult, RemoteRoster } from '../shared/api'
import { repositoryFor } from './history'
import { canonicalPath } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects'>
export const REMOTE_TIMEOUT_MS = 120_000
export const REMOTE_FETCH_ARGS = ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', 'protocol.ssh.allow=always',
  '-c', 'protocol.https.allow=always', '-c', 'protocol.git.allow=always'] as const
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const first = (stderr: string, fallback: string) => stderr.trim().split('\n')[0] || fallback

export function validRemoteName(name: string): boolean {
  return NAME.test(name) && name !== '.' && name !== '..' && !name.endsWith('.lock')
}

/** A small explicit transport list prevents Git's executable remote-helper URL syntax. */
export function validRemoteUrl(value: string): boolean {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith('-')) return false
  if (isAbsolute(value)) return true
  if (/^[^@/:\s]+@[^@/:\s]+:[^\s]+$/.test(value)) return true
  try {
    const url = new URL(value)
    return ['https:', 'ssh:', 'git:', 'file:'].includes(url.protocol)
      && !!(url.protocol === 'file:' ? url.pathname && !url.host : url.hostname)
      && !url.search && !url.hash && !url.password
  } catch { return false }
}

export class RemoteService {
  private readonly fetchState = new Map<string, { successAt: number | null; failureAt: number | null; error: string | null }>()
  private readonly pending = new Set<string>()
  private disposed = false
  private readonly lifetime = new AbortController()

  constructor(private readonly core: Core, private readonly now: () => number = Date.now) {}
  dispose(): void { this.disposed = true; this.lifetime.abort() }

  private async identity(repository: string): Promise<string> {
    const common = await this.core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repository, maxOutputBytes: 8192 })
    return common.code === 0 ? canonicalPath(resolve(repository, common.stdout.trim())) : repository
  }

  async roster(projectId: string): Promise<RemoteRoster> {
    const repository = await repositoryFor(this.core, projectId)
    const listed = await this.core.git.git(['remote'], { cwd: repository, maxOutputBytes: 8192 })
    if (listed.code !== 0) throw new BridgeError(422, 'git_failed', first(listed.stderr, 'Could not list remotes.'))
    const names = listed.stdout.trimEnd().split('\n').filter(Boolean)
    if (names.length > 32) throw new BridgeError(422, 'too_many_remotes', 'Git supports at most 32 remotes in Acorn.')
    const remotes = []
    for (const name of names) {
      if (!validRemoteName(name)) continue
      const [fetchUrl, pushUrl] = await Promise.all([
        this.core.git.git(['config', '--get', `remote.${name}.url`], { cwd: repository, maxOutputBytes: 4096 }),
        this.core.git.git(['config', '--get', `remote.${name}.pushurl`], { cwd: repository, maxOutputBytes: 4096 }),
      ])
      remotes.push({ name, fetchUrl: fetchUrl.stdout.trim(), pushUrl: pushUrl.code === 0 ? pushUrl.stdout.trim() : fetchUrl.stdout.trim() })
    }
    const identity = await this.identity(repository)
    const lastFetch = Object.fromEntries(remotes.map((remote) => [remote.name, this.fetchState.get(`${identity}:${remote.name}`) ?? { successAt: null, failureAt: null, error: null }]))
    return { repository, remotes, lastFetch }
  }

  async change(projectId: string, change: RemoteChange, signal?: AbortSignal): Promise<RemoteChangeResult> {
    let roster = await this.roster(projectId)
    const refuse = (reason: string): RemoteChangeResult => ({ ok: false, reason, roster })
    if (this.disposed) return refuse('Git is unavailable on this Node.')
    if (!validRemoteName(change.name)) return refuse('Invalid remote name.')
    const existing = roster.remotes.find((remote) => remote.name === change.name)
    if (change.action === 'add' ? !!existing : !existing || existing.fetchUrl !== change.expectedUrl) return refuse('Remote changed. Refresh and try again.')
    if ('url' in change && !validRemoteUrl(change.url)) return refuse('Use an HTTPS, SSH, Git, file, or absolute local URL. Executable helpers are unavailable.')
    if (change.action === 'fetch' && !validRemoteUrl(change.expectedUrl)) return refuse('This remote uses an unsupported URL transport.')
    const key = `${await this.identity(roster.repository)}:${change.name}`
    if (this.pending.has(key)) return refuse('A remote operation is already running for this repository and remote.')
    this.pending.add(key)
    try {
      roster = await this.roster(projectId)
      const fresh = roster.remotes.find((remote) => remote.name === change.name)
      if (change.action === 'add' ? !!fresh : !fresh || fresh.fetchUrl !== change.expectedUrl) return refuse('Remote changed. Refresh and try again.')
      const args = change.action === 'add' ? ['remote', 'add', '--', change.name, change.url]
        : change.action === 'remove' ? ['remote', 'remove', '--', change.name]
        : change.action === 'set-url' ? ['remote', 'set-url', '--', change.name, change.url, change.expectedUrl]
        : [...REMOTE_FETCH_ARGS, 'fetch', '--prune', '--', change.name]
      const result = await this.core.git.git(args, { cwd: roster.repository, maxOutputBytes: 32 * 1024,
        timeoutMs: change.action === 'fetch' ? REMOTE_TIMEOUT_MS : 30_000,
        env: change.action === 'fetch' ? { GIT_SSH_COMMAND: 'ssh' } : undefined,
        signal: signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal })
      if (change.action === 'fetch') this.fetchState.set(key, result.code === 0
        ? { successAt: this.now(), failureAt: this.fetchState.get(key)?.failureAt ?? null, error: null }
        : { successAt: this.fetchState.get(key)?.successAt ?? null, failureAt: this.now(), error: first(result.stderr, 'Fetch failed.') })
      roster = await this.roster(projectId)
      return { ok: result.code === 0, reason: result.code === 0 ? null : first(result.stderr, 'Git refused the remote operation.'), roster }
    } catch (error) {
      if (change.action !== 'fetch') throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.fetchState.set(key, { successAt: this.fetchState.get(key)?.successAt ?? null, failureAt: this.now(), error: reason })
      roster = await this.roster(projectId).catch(() => roster)
      return { ok: false, reason, roster }
    } finally { this.pending.delete(key) }
  }
}
