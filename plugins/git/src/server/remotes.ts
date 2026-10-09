import { isAbsolute, resolve } from 'node:path'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { RemoteChange, RemoteChangeResult, RemoteRoster } from '../shared/api'
import { repositoryFor } from './history'
import { canonicalPath } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects' | 'repositoryMetadata'>
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
  private disposed = false
  private readonly lifetime = new AbortController()

  constructor(private readonly core: Core, private readonly now: () => number = Date.now, private readonly changed: () => void = () => {}) {}
  dispose(): void { this.disposed = true; this.lifetime.abort() }

  private signal(request?: AbortSignal): AbortSignal {
    return request ? AbortSignal.any([request, this.lifetime.signal]) : this.lifetime.signal
  }

  private async identity(repository: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const common = await this.core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repository, maxOutputBytes: 8192, signal })
    signal?.throwIfAborted()
    if (common.code !== 0 || common.truncated) throw new BridgeError(409, 'repository_unavailable', 'Could not verify repository identity.')
    const path = await canonicalPath(resolve(repository, common.stdout.trim()))
    signal?.throwIfAborted()
    return path
  }

  async roster(projectId: string, signal?: AbortSignal): Promise<RemoteRoster> {
    return this.readRoster(projectId, this.signal(signal))
  }

  private async readRoster(projectId: string, active: AbortSignal): Promise<RemoteRoster> {
    active.throwIfAborted()
    const repository = await repositoryFor(this.core, projectId, active)
    active.throwIfAborted()
    const listed = await this.core.git.git(['remote'], { cwd: repository, maxOutputBytes: 8192, signal: active })
    active.throwIfAborted()
    if (listed.code !== 0 || listed.truncated) throw new BridgeError(422, 'git_failed', first(listed.stderr, 'Could not list complete remotes.'))
    const names = listed.stdout.trimEnd().split('\n').filter(Boolean)
    if (names.length > 32) throw new BridgeError(422, 'too_many_remotes', 'Git supports at most 32 remotes in Acorn.')
    const remotes = []
    for (const name of names) {
      active.throwIfAborted()
      if (!validRemoteName(name)) throw new BridgeError(422, 'invalid_remote', 'Cannot inspect a remote with an unsupported name.')
      const [fetchUrl, pushUrl] = await Promise.all([
        this.core.git.git(['config', '--local', '--get-all', `remote.${name}.url`], { cwd: repository, maxOutputBytes: 8192, signal: active }),
        this.core.git.git(['config', '--local', '--get-all', `remote.${name}.pushurl`], { cwd: repository, maxOutputBytes: 8192, signal: active }),
      ])
      active.throwIfAborted()
      if (fetchUrl.code !== 0 || fetchUrl.truncated || pushUrl.truncated || (pushUrl.code !== 0 && pushUrl.code !== 1)) throw new BridgeError(422, 'git_failed', 'Could not inspect complete remote URLs.')
      const fetchUrls = fetchUrl.stdout.trimEnd().split('\n')
      const pushUrls = pushUrl.code === 0 ? pushUrl.stdout.trimEnd().split('\n') : []
      remotes.push({ name, fetchUrl: fetchUrls[0] ?? '', pushUrl: pushUrls[0] ?? fetchUrls[0] ?? '', fetchUrlCount: fetchUrls.length, pushUrlCount: pushUrls.length })
    }
    const identity = await this.identity(repository, active)
    active.throwIfAborted()
    const lastFetch = Object.fromEntries(remotes.map((remote) => [remote.name, this.fetchState.get(`${identity}:${remote.name}`) ?? { successAt: null, failureAt: null, error: null }]))
    return { repository, remotes, lastFetch }
  }

  async change(projectId: string, change: RemoteChange, signal?: AbortSignal): Promise<RemoteChangeResult> {
    const active = this.signal(signal)
    active.throwIfAborted()
    let roster = await this.readRoster(projectId, active)
    const refuse = (reason: string): RemoteChangeResult => ({ ok: false, reason, roster, postState: 'fresh', command: null })
    const moved = (): RemoteChangeResult => ({ ok: false, reason: 'Project repository changed. Reopen the action.',
      roster, postState: 'unavailable', command: null })
    active.throwIfAborted()
    if (!validRemoteName(change.name)) return refuse('Invalid remote name.')
    const existing = roster.remotes.find((remote) => remote.name === change.name)
    if (change.action === 'add' ? !!existing : !existing || existing.fetchUrl !== change.expectedUrl) return refuse('Remote changed. Refresh and try again.')
    if ('url' in change && !validRemoteUrl(change.url)) return refuse('Use an HTTPS, SSH, Git, file, or absolute local URL. Executable helpers are unavailable.')
    if (change.action === 'fetch' && !validRemoteUrl(change.expectedUrl)) return refuse('This remote uses an unsupported URL transport.')
    const observedRepository = roster.repository
    const observedCommon = await this.identity(observedRepository, active)
    return this.core.repositoryMetadata.write(projectId, async (repository, common) => {
      active.throwIfAborted()
      if (repository !== observedRepository || common !== observedCommon) return moved()
      const latest = await this.readRoster(projectId, active)
      if (latest.repository !== observedRepository || await this.identity(latest.repository, active) !== observedCommon) return moved()
      roster = latest
      const fresh = roster.remotes.find((remote) => remote.name === change.name)
      if (change.action === 'add' ? !!fresh : !fresh || fresh.fetchUrl !== change.expectedUrl) return refuse('Remote changed. Refresh and try again.')
      if (change.action === 'set-url' && fresh!.fetchUrlCount !== 1) return refuse('This remote has multiple fetch URLs. Edit them in Git before changing the URL here.')
      const args = change.action === 'add' ? ['remote', 'add', '--', change.name, change.url]
        : change.action === 'remove' ? ['remote', 'remove', '--', change.name]
        : change.action === 'set-url' ? ['config', '--local', '--replace-all', `remote.${change.name}.url`, change.url]
        : [...REMOTE_FETCH_ARGS, 'fetch', '--prune', '--', change.name]
      let command: RemoteChangeResult['command']
      active.throwIfAborted()
      try {
        const result = await this.core.git.git(args, { cwd: observedRepository, maxOutputBytes: 32 * 1024,
          timeoutMs: change.action === 'fetch' ? REMOTE_TIMEOUT_MS : 30_000,
          env: change.action === 'fetch' ? { GIT_SSH_COMMAND: 'ssh' } : undefined, signal: active })
        command = { code: result.code, error: result.code === 0 ? null : first(result.stderr, 'Git refused the remote operation.') }
      } catch (error) {
        command = { code: null, error: error instanceof Error ? error.message : String(error) }
      } finally {
        // Even a failed or aborted fetch may have updated some tracking refs.
        this.changed()
      }
      const key = `${observedCommon}:${change.name}`
      if (change.action === 'fetch') this.fetchState.set(key, command.code === 0
        ? { successAt: this.now(), failureAt: this.fetchState.get(key)?.failureAt ?? null, error: null }
        : { successAt: this.fetchState.get(key)?.successAt ?? null, failureAt: this.now(), error: command.error })
      try {
        active.throwIfAborted()
        const currentRoster = await this.readRoster(projectId, active)
        if (currentRoster.repository !== observedRepository || await this.identity(currentRoster.repository, active) !== observedCommon)
          throw new Error('Project repository changed during readback.')
        return { ok: command.code === 0, reason: command.error, roster: currentRoster, postState: 'fresh', command }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return { ok: command.code === 0, reason: `${command.error ? `${command.error} ` : 'Git command completed. '}Post-state unavailable: ${detail}`,
          roster, postState: 'unavailable', command }
      }
    })
  }
}
