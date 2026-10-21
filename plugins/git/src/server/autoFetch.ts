import { resolve } from 'node:path'
import type { CoreServices } from '@acorn/plugin-api/node'
import { canonicalPath } from './worktreeRoster'
import type { RemoteService } from './remotes'
import { AUTO_FETCH_PREF } from './settings'

type Core = Pick<CoreServices, 'git' | 'projects' | 'prefs' | 'identity'>
type RemoteReader = Pick<RemoteService, 'roster' | 'change'>
export const AUTO_FETCH_CADENCE_MS = 5 * 60_000

/** One Node schedule pass. The scheduler owns the timer; this class owns per-repository timing. */
export class AutoFetcher {
  private readonly lastAttempt = new Map<string, number>()
  private running = false
  private disposed = false
  private readonly lifetime = new AbortController()
  private enabledLifetime = new AbortController()

  constructor(
    private readonly core: Core,
    private readonly remotes: RemoteReader,
    private readonly now: () => number = Date.now,
  ) {}
  dispose(): void {
    this.disposed = true
    this.lifetime.abort()
    this.enabledLifetime.abort()
  }
  setEnabled(enabled: boolean): void {
    if (!enabled) this.enabledLifetime.abort()
    else if (this.enabledLifetime.signal.aborted && !this.disposed) this.enabledLifetime = new AbortController()
  }

  private async enabled(): Promise<boolean> {
    const owner = this.core.identity.active()
    return !!owner && (await this.core.prefs.read(owner, AUTO_FETCH_PREF)) === 'true'
  }

  private async projectsByRepository(signal: AbortSignal): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    for (const project of (await this.core.projects.checkouts()).slice(0, 128)) {
      if (signal.aborted) break
      try {
        const common = await this.core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
          cwd: project.path,
          maxOutputBytes: 8192,
          signal,
        })
        if (signal.aborted) break
        if (common.code === 0 && !common.truncated) {
          const key = await canonicalPath(resolve(project.path, common.stdout.trim()))
          if (!result.has(key)) result.set(key, project.id)
        }
      } catch {
        /* An unavailable project does not block other repositories. */
      }
    }
    return result
  }

  async tick(signal?: AbortSignal): Promise<string> {
    if (this.running || this.disposed) return 'auto-fetch disabled or already running'
    this.running = true
    const combined = AbortSignal.any([...(signal ? [signal] : []), this.lifetime.signal, this.enabledLifetime.signal])
    let fetched = 0,
      failures = 0
    try {
      if (!(await this.enabled()) || combined.aborted) return 'auto-fetch disabled or already running'
      const repositories = [...(await this.projectsByRepository(combined)).entries()].filter(
        ([key]) => this.now() - (this.lastAttempt.get(key) ?? -Infinity) >= AUTO_FETCH_CADENCE_MS,
      )
      for (let at = 0; at < repositories.length && !combined.aborted && !this.disposed; at += 2) {
        await Promise.all(
          repositories.slice(at, at + 2).map(async ([key, projectId]) => {
            this.lastAttempt.set(key, this.now())
            try {
              if (!(await this.enabled()) || combined.aborted || this.disposed) return
              const roster = await this.remotes.roster(projectId, combined)
              for (const remote of roster.remotes) {
                if (!(await this.enabled()) || combined.aborted || this.disposed) return
                const result = await this.remotes.change(
                  projectId,
                  { action: 'fetch', name: remote.name, expectedUrl: remote.fetchUrl },
                  combined,
                  'background',
                )
                if (result.ok) fetched++
                else failures++
              }
            } catch {
              failures++
            }
          }),
        )
      }
      return `${fetched} remotes fetched, ${failures} failed`
    } finally {
      this.running = false
    }
  }
}
