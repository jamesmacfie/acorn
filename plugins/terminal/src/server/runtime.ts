// Runtime service: owns run-target instances per task (docs/terminal/run-targets.md § Process
// broker). An instance is just a terminal session in the task's worktree, so status derives from the
// session map. Reachability comes from the target's `url` (fixed) or `url_command`
// (run-and-parse-stdout, the existing term:previewUrl shape). acorn allocates no ports; isolation is
// the script's job via ACORN_*. Deps are injected so the service is unit-testable under plain Node
// (the run IPC wires the PTY glue).
import type { RunStatus, RunTargetInfo } from '@acorn/protocol/runTargets.ts' // canonical wire shapes — never redeclared here
import type { LayoutRecipe, PluginHookRegistry, RunTarget } from '@acorn/plugin-api/node'

export type RuntimeDeps = {
  // Config + cwd for a task (loadRepoConfig over worktree/checkout + DB fallback in the app).
  // `errors` carries structured config parse errors for the palette rows; `layouts` the
  // [layout.<id>] recipes (docs/workspaces-and-tasks/project-config.md § Layout recipes).
  // `repoTargetIds` names the targets whose winning layer was the checkout's own `.acorn/config.toml`,
  // which is untrusted input: those are the ones that must pass the trust gate before they run. It is
  // required, not optional. Both halves of this gate used to be optional, so a deps object that simply
  // omitted them compiled fine and silently ran a cloned repository's committed command with no
  // review. The type carries the gate now, and a caller that cannot answer has to say so out loud.
  loadTargets(taskId: string): Promise<
    | { targets: RunTarget[]; cwd: string; errors?: { source: string; message: string }[]; layouts?: LayoutRecipe[]; repoTargetIds: string[]; repoConfigHash: string | null }
    | { error: string }
  >
  // Spawn the target's command as a terminal session in cwd (ACORN_* env rides spawnOne). → session id.
  startSession(taskId: string, target: RunTarget, cwd: string): Promise<string>
  isRunning(sessionId: string): boolean
  /** Observe authoritative PTY exits for sessions started by this service. */
  onExit(listener: (sessionId: string, exitCode: number | null) => void): () => void
  /** The owner's half of `terminal:before-run-target` (docs/plugins/hooks.md § Hooks). Absent means nobody
   *  objects, which is also what an empty chain means. */
  hooks?: Pick<PluginHookRegistry, 'run'>
  exitCode(sessionId: string): number | null | undefined
  killSession(sessionId: string): void
  /** Retire a late session attachment after this service has been disposed. */
  retireSession(sessionId: string): void
  // Run a short-lived script (stop / url_command) in cwd; ok + trimmed stdout.
  runScript(taskId: string, script: string, cwd: string): Promise<{ ok: boolean; output?: string; reason?: string }>
  // Throws when the repo's configuration has not been acknowledged (server/repoConfigTrust.ts). Required
  // for the same reason `repoTargetIds` is. The expected hash must match the current approved snapshot.
  authorizeRepoConfig(taskId: string, expectedHash: string): Promise<void>
  // A declared target started or stopped through this service (docs/plugins/events.md § Hearing a core event
  // § Run target state). Optional so callers that only need the read model need not observe it.
  onChange?(taskId: string, targetId: string, running: boolean): void
}

// The last non-empty stdout line is the URL (same parse as term:previewUrl).
export const parseUrlOutput = (output: string | undefined): string | undefined =>
  output
    ?.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()

// url wins over url_command; neither → undefined. Only consulted while the instance runs.
export async function resolveTargetUrl(
  target: Pick<RunTarget, 'url' | 'urlCommand'>,
  runUrlCommand: (script: string) => Promise<{ ok: boolean; output?: string }>,
): Promise<string | undefined> {
  if (target.url) return target.url
  if (target.urlCommand) {
    const res = await runUrlCommand(target.urlCommand)
    return res.ok ? parseUrlOutput(res.output) : undefined
  }
  return undefined
}

type RunResult = { ok: boolean; reason?: string; sessionId?: string }

type Instance = { sessionId: string; target: RunTarget; cwd: string }

export class RuntimeService {
  private instances = new Map<string, Instance>() // `${taskId}\u0000${targetId}`
  private instanceKeysBySession = new Map<string, string>()
  private lastExitCodes = new Map<string, number | null>()
  private disposed = false
  private operations = new Map<string, { kind: 'start' | 'stop' | 'restart'; promise: Promise<RunResult> }>()
  private readonly stopObservingExits: () => void

  constructor(private deps: RuntimeDeps) {
    this.stopObservingExits = deps.onExit((sessionId, exitCode) => {
      const key = this.instanceKeysBySession.get(sessionId)
      if (!key) return
      const instance = this.instances.get(key)
      if (!instance || instance.sessionId !== sessionId) return
      this.instances.delete(key)
      this.instanceKeysBySession.delete(sessionId)
      this.lastExitCodes.set(key, exitCode)
      const separator = key.indexOf('\0')
      this.deps.onChange?.(key.slice(0, separator), key.slice(separator + 1), false)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try { this.stopObservingExits() } finally {
      this.operations.clear()
      this.instances.clear()
      this.instanceKeysBySession.clear()
      this.lastExitCodes.clear()
    }
  }

  private key = (taskId: string, targetId: string) => `${taskId}\u0000${targetId}`

  private operate(taskId: string, targetId: string, kind: 'start' | 'stop' | 'restart', run: () => Promise<RunResult>): Promise<RunResult> {
    if (this.disposed) return Promise.resolve({ ok: false, reason: 'Run target service disposed.' })
    const key = this.key(taskId, targetId)
    const previous = this.operations.get(key)
    if (kind === 'start' && previous?.kind === 'start') return previous.promise
    const operation = { kind, promise: Promise.resolve<RunResult>({ ok: false }) }
    operation.promise = (previous ? previous.promise.then(() => {}, () => {}) : Promise.resolve())
      .then(() => this.disposed ? { ok: false, reason: 'Run target service disposed.' } : run())
      .finally(() => { if (this.operations.get(key) === operation) this.operations.delete(key) })
    this.operations.set(key, operation)
    return operation.promise
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('Run target service disposed.')
  }

  async targets(
    taskId: string,
  ): Promise<{ targets: RunTargetInfo[]; errors: { source: string; message: string }[]; layouts: LayoutRecipe[] } | { error: string }> {
    const cfg = await this.deps.loadTargets(taskId)
    this.assertLive()
    if ('error' in cfg) return cfg
    return {
      targets: cfg.targets.map((t) => {
        const inst = this.instances.get(this.key(taskId, t.id))
        return { ...t, running: !!inst && this.deps.isRunning(inst.sessionId) }
      }),
      errors: cfg.errors ?? [],
      layouts: cfg.layouts ?? [],
    }
  }

  start(taskId: string, targetId: string): Promise<RunResult> {
    return this.operate(taskId, targetId, 'start', () => this.startOwned(taskId, targetId))
  }

  private async startOwned(taskId: string, targetId: string): Promise<RunResult> {
    const existing = this.instances.get(this.key(taskId, targetId))
    if (existing && this.deps.isRunning(existing.sessionId)) return { ok: true, sessionId: existing.sessionId }
    const cfg = await this.deps.loadTargets(taskId)
    this.assertLive()
    if ('error' in cfg) return { ok: false, reason: cfg.error }
    const target = cfg.targets.find((t) => t.id === targetId)
    if (!target) return { ok: false, reason: `No run target '${targetId}'.` }
    if (cfg.repoTargetIds.includes(targetId)) {
      if (!cfg.repoConfigHash) throw Object.assign(new Error('Repo configuration must be reviewed and trusted before it can run.'), { code: 'needs-trust' })
      await this.deps.authorizeRepoConfig(taskId, cfg.repoConfigHash)
    }
    this.assertLive()
    // Another plugin's turn before a process starts in this worktree (docs/plugins/hooks.md § Hooks). Observe
    // and veto only: the design sketched a transform over the target's environment, and a payload is
    // scalars and arrays of scalars, so an env map is not expressible in the declared vocabulary. That
    // section's "What is refused" carries the argument.
    const verdict = await this.deps.hooks?.run('before-run-target', {
      taskId,
      targetId,
      command: target.command ?? '',
      cwd: cfg.cwd,
    })
    this.assertLive()
    if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
    const sessionId = await this.deps.startSession(taskId, target, cfg.cwd)
    if (this.disposed) {
      // The engine owns durable sessions. Retiring its attachment must not destroy tmux state.
      this.deps.retireSession(sessionId)
      return { ok: false, reason: 'Run target service disposed.' }
    }
    const key = this.key(taskId, targetId)
    if (existing) {
      this.instances.delete(key)
      this.instanceKeysBySession.delete(existing.sessionId)
    }
    if (!this.deps.isRunning(sessionId)) {
      this.lastExitCodes.set(key, this.deps.exitCode(sessionId) ?? null)
      return { ok: true, sessionId }
    }
    this.instances.set(key, { sessionId, target, cwd: cfg.cwd })
    this.instanceKeysBySession.set(sessionId, key)
    this.lastExitCodes.delete(key)
    this.deps.onChange?.(taskId, targetId, true)
    return { ok: true, sessionId }
  }

  // Declared `stop` runs first (compose down, etc., while the instance still exists), then the
  // session is killed if it's still up. No declared stop just kills.
  stop(taskId: string, targetId: string): Promise<RunResult> {
    return this.operate(taskId, targetId, 'stop', () => this.stopOwned(taskId, targetId))
  }

  private async stopOwned(taskId: string, targetId: string): Promise<RunResult> {
    const inst = this.instances.get(this.key(taskId, targetId))
    if (!inst) return { ok: false, reason: 'Not running.' }
    if (inst.target.stop) {
      const res = await this.deps.runScript(taskId, inst.target.stop, inst.cwd)
      this.assertLive()
      if (!res.ok) return { ok: false, reason: res.reason ?? 'Stop script failed.' }
    }
    const announce = this.instances.get(this.key(taskId, targetId)) === inst
    this.instances.delete(this.key(taskId, targetId))
    this.instanceKeysBySession.delete(inst.sessionId)
    this.lastExitCodes.delete(this.key(taskId, targetId))
    try {
      if (this.deps.isRunning(inst.sessionId)) this.deps.killSession(inst.sessionId)
    } catch (error) {
      if (this.deps.isRunning(inst.sessionId)) {
        this.instances.set(this.key(taskId, targetId), inst)
        this.instanceKeysBySession.set(inst.sessionId, this.key(taskId, targetId))
      } else if (announce) this.deps.onChange?.(taskId, targetId, false)
      throw error
    }
    if (announce) this.deps.onChange?.(taskId, targetId, false)
    return { ok: true }
  }

  // Restart: run the target's explicit `restart` command if it declares one (an in-place restart:
  // Rails `bin/rails restart`, a HMR trigger, etc.), otherwise stop-then-start. Stop's "not running"
  // is ignored in the fallback so restart doubles as a cold start.
  restart(taskId: string, targetId: string): Promise<RunResult> {
    return this.operate(taskId, targetId, 'restart', () => this.restartOwned(taskId, targetId))
  }

  private async restartOwned(taskId: string, targetId: string): Promise<RunResult> {
    const cfg = await this.deps.loadTargets(taskId)
    this.assertLive()
    if ('error' in cfg) return { ok: false, reason: cfg.error }
    const target = cfg.targets.find((t) => t.id === targetId)
    if (!target) return { ok: false, reason: `No run target '${targetId}'.` }
    if (cfg.repoTargetIds.includes(targetId)) {
      if (!cfg.repoConfigHash) throw Object.assign(new Error('Repo configuration must be reviewed and trusted before it can run.'), { code: 'needs-trust' })
      await this.deps.authorizeRepoConfig(taskId, cfg.repoConfigHash)
    }
    this.assertLive()
    if (target.restart) {
      const inst = this.instances.get(this.key(taskId, targetId))
      const res = await this.deps.runScript(taskId, target.restart, inst?.cwd ?? cfg.cwd)
      this.assertLive()
      return res.ok ? { ok: true, sessionId: inst?.sessionId } : { ok: false, reason: res.reason ?? 'Restart script failed.' }
    }
    if (this.instances.has(this.key(taskId, targetId))) {
      const stopped = await this.stopOwned(taskId, targetId)
      if (!stopped.ok) return stopped
    }
    this.assertLive()
    return this.startOwned(taskId, targetId)
  }

  private currentStatus(taskId: string, targetId: string): RunStatus {
    if (this.disposed) return { running: false }
    const inst = this.instances.get(this.key(taskId, targetId))
    if (!inst) {
      const exitCode = this.lastExitCodes.get(this.key(taskId, targetId))
      return exitCode === undefined ? { running: false } : { running: false, exitCode }
    }
    const running = this.deps.isRunning(inst.sessionId)
    if (!running) return { running: false, exitCode: this.deps.exitCode(inst.sessionId) ?? null }
    return { running: true }
  }

  async status(taskId: string, targetId: string): Promise<RunStatus> {
    const current = this.currentStatus(taskId, targetId)
    const key = this.key(taskId, targetId)
    const inst = this.instances.get(key)
    if (!current.running || !inst) return current
    const url = await resolveTargetUrl(inst.target, (script) => this.deps.runScript(taskId, script, inst.cwd))
    if (this.disposed || this.instances.get(key) !== inst || !this.deps.isRunning(inst.sessionId)) {
      return this.currentStatus(taskId, targetId)
    }
    return { running: true, url }
  }

  // The default target's URL for the browser/preview home (docs/terminal/run-targets.md § Process
  // broker).
  async defaultUrl(taskId: string): Promise<string | undefined> {
    const cfg = await this.deps.loadTargets(taskId)
    this.assertLive()
    if ('error' in cfg || !cfg.targets.length) return undefined
    const target = cfg.targets.find((t) => t.default) ?? cfg.targets[0]
    const inst = this.instances.get(this.key(taskId, target.id))
    // A fixed URL is always usable; a discovered one needs the instance up.
    if (target.url) return target.url
    if (!inst || !this.deps.isRunning(inst.sessionId)) return undefined
    // Execute only the command captured at admission, even if this target was edited on disk.
    const url = await resolveTargetUrl(inst.target, (script) => this.deps.runScript(taskId, script, inst.cwd))
    return !this.disposed && this.instances.get(this.key(taskId, target.id)) === inst && this.deps.isRunning(inst.sessionId)
      ? url : undefined
  }
}
