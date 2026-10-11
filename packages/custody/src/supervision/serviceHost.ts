import { spawn, type ChildProcess } from 'node:child_process'
import { z } from 'zod'
import {
  ServiceRpcPeer,
  previewBrowserRuleSchema,
  serviceStartConfigSchema,
  serviceStartResultSchema,
  serviceStateEventSchema,
  type PreviewBrowserRule,
  type ServiceMessage,
  type ServiceMessageTransport,
  type NodeKeys,
  type ServiceStartConfig,
  type ServiceStartResult,
  type ServiceState,
} from '@acorn/protocol/serviceProtocol.ts'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'
import { compileCacheDir } from './compileCache'

const log = createLogger('service-host')

export type ServiceHostEvents = {
  stateChanged?(state: ServiceState, detail?: string): void
  unexpectedExit?(code: number): void
}

// How long a well-behaved service gets to exit after SIGTERM. Its own handler drains the listener,
// the PTYs, and SQLite, which is worth waiting for, but a wedged one holding the data root's lock is
// worse than a hard kill. See server/storage/dataRoot.ts.
const KILL_ESCALATION_MS = 5_000

// How long to keep waiting after SIGKILL before leaving anyway. SIGKILL cannot be caught or ignored,
// so reaching this means the child is stuck in an uninterruptible syscall, and holding the shell's
// quit open for it forever is worse than the orphan.
const GIVE_UP_MS = 2_000

// Never in the node's environment, wherever they came from. The node takes its keys from the start
// message, and nothing reads the GitHub client secret, because the device grant uses none.
const SECRET_NAMES = new Set(['SESSION_ENC_KEY', 'INTERNAL_TOKEN', 'GITHUB_CLIENT_SECRET'])
const SECRET_SHAPED = /_(KEY|SECRET|TOKEN)$/

// The environment the node starts with, which `ps eww` shows to any process running as this user for
// as long as the node runs. `fromEnvFiles` names the variables the host loaded from `.env` files: those
// appear nowhere else, so a secret-shaped one stays out. A variable the person's own launch
// environment already held is visible on every ancestor process anyway, and a harness may pass it on
// to its agent (`envPassthrough`), so it stays in.
export function serviceEnvironment(env: NodeJS.ProcessEnv, fromEnvFiles: ReadonlySet<string>): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !SECRET_NAMES.has(name) && !(fromEnvFiles.has(name) && SECRET_SHAPED.test(name)),
    ),
  )
}

export class ServiceHost {
  private child: ChildProcess | null = null
  private peer: ServiceRpcPeer | null = null
  private stopping = false

  constructor(
    private readonly entry: string,
    private readonly config: Omit<ServiceStartConfig, 'deviceToken' | 'keys'>,
    // Already stripped by `serviceEnvironment`.
    private readonly env: NodeJS.ProcessEnv,
    private readonly events: ServiceHostEvents = {},
    // The parent of the service's compile cache (./compileCache.ts). Without one, every start
    // compiles the whole bundle from scratch.
    private readonly compileCacheRoot?: string,
  ) {
    serviceStartConfigSchema.omit({ deviceToken: true, keys: true }).parse(config)
  }

  // Resolves with where the service bound, who it is, and the bearer to reach it with, which is
  // everything the connection broker needs. The caller supplies the remembered device token so the
  // service reuses it instead of creating a device row on every launch, and the node's keys, which
  // travel only in this message (custody/nodeKeys.ts).
  async start(rememberedDeviceToken: string | undefined, keys: NodeKeys): Promise<ServiceStartResult> {
    if (this.child) throw new Error('Service host is already started')
    this.stopping = false
    // Worked out here rather than in the constructor, so the old build's cache is removed after the
    // helper's ready line, not before it.
    const compileCache = this.compileCacheRoot ? compileCacheDir(this.compileCacheRoot, this.entry) : undefined
    const child = spawn(process.execPath, [this.entry], {
      // `process.execPath` is the Node the bundle ships, so the child needs no system Node install
      // and the bundled node-pty finds the ABI it was built against. See docs/shell.md, "Build and
      // packaging". Terminals, agents, and scripts get an allowlisted environment
      // (server/taskEnv.ts), so the compile cache variable does not reach them. A Node program that
      // inherits it anyway, through one of the few tools spawned with the full environment, only adds
      // its own entries, because Node keeps each runtime version apart.
      env: { ...this.env, ...(compileCache ? { NODE_COMPILE_CACHE: compileCache } : {}) },
      // stdin closed, because the service never reads it. stdout and stderr inherited, so its logs
      // land wherever the app's do. fd 3 is the IPC channel that gives the child `process.send`.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.child = child

    const transport: ServiceMessageTransport = {
      // Send can throw once the channel is gone, when a child crashes between the exit handler
      // running and a caller's in-flight request. The peer's own timeout is the backstop, and a throw
      // here would surface as an unhandled rejection in whatever happened to be sending.
      send: (message: ServiceMessage) => {
        try {
          child.send(message)
        } catch (error) {
          log.warn(`send failed; the service channel is gone: ${describeError(error).message}`)
        }
      },
      subscribe: (listener) => {
        const receive = (message: unknown) => listener(message)
        child.on('message', receive)
        return () => child.off('message', receive)
      },
    }
    const peer = new ServiceRpcPeer(transport)
    this.peer = peer
    peer.onEvent('service.state', (payload) => {
      const parsed = serviceStateEventSchema.safeParse(payload)
      if (parsed.success) this.events.stateChanged?.(parsed.data.state, parsed.data.detail)
    })

    const spawned = new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('exit', onEarlyExit)
        child.off('error', onEarlyExit)
        resolve()
      }
      const onEarlyExit = (reason: number | Error | null): void => {
        child.off('spawn', onSpawn)
        reject(reason instanceof Error ? reason : new Error(`Service exited before startup (code ${reason})`))
      }
      child.once('spawn', onSpawn)
      child.once('exit', onEarlyExit)
      child.once('error', onEarlyExit)
    })
    child.on('exit', (code) => this.handleExit(child, code ?? 0))
    await spawned
    const result = await peer.request(
      'service.start',
      { ...this.config, deviceToken: rememberedDeviceToken, keys },
      60_000,
    )
    // Parsed, not cast. A malformed handoff would otherwise surface much later as an unreachable node
    // with no explanation.
    return serviceStartResultSchema.parse(result)
  }

  async previewRules(taskId: string): Promise<PreviewBrowserRule[]> {
    const peer = this.peer
    if (!peer) return []
    const value = await peer.request('service.preview-rules', { taskId })
    return z.array(previewBrowserRuleSchema).parse(value)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    try {
      await this.peer?.request('service.stop', {}, 15_000)
    } catch (error) {
      log.warn(`graceful stop failed: ${describeError(error).message}`)
    }
    this.disposeConnection('Service stopped')
    await this.terminate(child)
    this.child = null
  }

  // SIGTERM, then SIGKILL if it is ignored. The service installs its own SIGTERM handler to drain
  // cleanly, so the polite signal is the one that matters. A wedged child holding the data root's
  // exclusive lock blocks the next launch, though, and a signal with no follow-up can leave it alive as
  // an orphan indefinitely.
  //
  // Awaited, and the escalation timer is not unref'd. Both matter, and for the same reason: this
  // process must not exit while the service is still alive. The caller's shutdown runs `process.exit`
  // as soon as this resolves, an unref'd timer does not hold the event loop open, and `process.exit`
  // does not wait for one anyway, so otherwise the SIGKILL would never be sent on the path that needs it
  // most. A service that ignored SIGTERM would be orphaned holding the data root's lock, and the next
  // launch would refuse to start until somebody killed a pid by hand.
  private terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timers = [
        setTimeout(() => child.kill('SIGKILL'), KILL_ESCALATION_MS),
        setTimeout(() => finish(), KILL_ESCALATION_MS + GIVE_UP_MS),
      ]
      const finish = (): void => {
        for (const timer of timers) clearTimeout(timer)
        child.off('exit', finish)
        resolve()
      }
      child.once('exit', finish)
      child.kill('SIGTERM')
    })
  }

  private handleExit(child: ChildProcess, code: number): void {
    if (this.child !== child) return
    const unexpected = !this.stopping
    this.child = null
    this.disposeConnection(`Service exited with code ${code}`)
    if (unexpected) this.events.unexpectedExit?.(code)
  }

  private disposeConnection(reason: string): void {
    this.peer?.close(reason)
    this.peer = null
  }
}
