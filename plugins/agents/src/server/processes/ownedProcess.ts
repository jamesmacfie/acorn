import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export const PROTOCOL_CLOSE_MS = 1_000
const SIGNAL_GRACE_MS = 2_000
const EXIT_ACK_MS = 2_000

export class ProcessRetirementError extends Error {}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Owns only a group created by this launch, never an ambient process tree. */
export class OwnedProcess {
  readonly exited: Promise<void>
  #exited = false
  #stop: Promise<void> | null = null

  constructor(
    private readonly pid: number | undefined,
    observeExit: (done: () => void) => void,
    private readonly signalChild: (signal: NodeJS.Signals) => void,
    private readonly graceMs = SIGNAL_GRACE_MS,
  ) {
    this.exited = new Promise((resolve) => observeExit(() => {
      this.#exited = true
      resolve()
    }))
  }

  #groupAlive(): boolean {
    if (process.platform === 'win32' || !this.pid) return false
    try {
      process.kill(-this.pid, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      // Permission denial is evidence of existence, not acknowledgement. Poll through transient
      // exit states; a group that remains inaccessible still fails the acknowledgement deadline.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
      throw error
    }
  }

  #signal(signal: NodeJS.Signals): void {
    if (process.platform !== 'win32' && this.pid) {
      try { process.kill(-this.pid, signal) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    } else if (!this.#exited) {
      this.signalChild(signal)
    }
  }

  stop(polite?: () => void | Promise<unknown>, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    return this.#stop ??= this.#retire(polite, signal).catch((error: unknown) => {
      throw new ProcessRetirementError(error instanceof Error ? error.message : 'Agent process retirement failed.', { cause: error })
    })
  }

  async #retire(polite: (() => void | Promise<unknown>) | undefined, signal: NodeJS.Signals): Promise<void> {
    if (polite) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.resolve().then(polite).catch(() => undefined),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, PROTOCOL_CLOSE_MS) }),
        ])
      } finally { clearTimeout(timer) }
    }
    this.#signal(signal)
    const graceUntil = Date.now() + this.graceMs
    while ((!this.#exited || this.#groupAlive()) && Date.now() < graceUntil) await delay(20)
    // A direct parent exit does not cancel escalation while a group member remains.
    if (!this.#exited || this.#groupAlive()) this.#signal('SIGKILL')
    const ackUntil = Date.now() + EXIT_ACK_MS
    while ((!this.#exited || this.#groupAlive()) && Date.now() < ackUntil) await delay(20)
    if (!this.#exited || this.#groupAlive()) throw new Error('Agent process exit was not acknowledged.')
  }
}

export function spawnOwnedProcess(options: {
  command: string
  args: string[]
  cwd?: string
  env: NodeJS.ProcessEnv
}): { child: ChildProcessWithoutNullStreams; owner: OwnedProcess } {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const owner = new OwnedProcess(child.pid, (done) => {
    child.once('exit', done)
    child.once('error', () => { if (!child.pid) done() })
  }, (signal) => { child.kill(signal) })
  return { child, owner }
}
