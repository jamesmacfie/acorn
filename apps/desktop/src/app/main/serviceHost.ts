import { spawn, type ChildProcess } from 'node:child_process'
import { z } from 'zod'
import { registerDesktopCapabilityHandlers } from './desktopCapabilities'
import {
  ServiceRpcPeer,
  previewBrowserRuleSchema,
  serviceStartConfigSchema,
  serviceStartResultSchema,
  serviceStateEventSchema,
  type PreviewBrowserRule,
  type ServiceMessage,
  type ServiceMessageTransport,
  type ServiceStartConfig,
  type ServiceStartResult,
  type ServiceState,
} from '@acorn/protocol/serviceProtocol.ts'

export type ServiceHostEvents = {
  stateChanged?(state: ServiceState, detail?: string): void
  unexpectedExit?(code: number): void
}

// How long a well-behaved service gets to exit after SIGTERM before we stop being polite. Its own
// handler drains the listener, the PTYs and SQLite, which is worth waiting for; a wedged one holding
// the data root's lock is worse than a hard kill (main/dataRoot.ts).
const KILL_ESCALATION_MS = 5_000

// Supervises the Node service as an ordinary child process (docs/vNext/architecture.md: "the desktop
// build embeds the built Node artifact and spawns it as a child process").
//
// It used to be an Electron utilityProcess. The change buys two things and costs nothing measurable:
// the service becomes a process this repo can start WITHOUT Electron — which is what makes the spawn
// integration test possible, and what a headless node will need — and `stdio: 'ipc'` is a plain
// Node channel, so `apps/node/src/service/index.ts` speaks `process.send` instead of shimming
// Electron's `parentPort` against plain-Node types.
//
// Three things that look risky and are not. ELECTRON_RUN_AS_NODE=1 on process.execPath is already the
// shipped pattern (main/mcpRegister.ts launches out/main/mcp.js that way from inside app.asar). The
// better-sqlite3 / node-pty ABI is unchanged, because that is still Electron's V8. And the artifact is
// ESM under a "type": "module" package, which the IPC channel does not care about.
export class ServiceHost {
  private child: ChildProcess | null = null
  private peer: ServiceRpcPeer | null = null
  private disposeDesktopHandlers: (() => void) | null = null
  private stopping = false

  constructor(
    private readonly entry: string,
    private readonly config: ServiceStartConfig,
    private readonly events: ServiceHostEvents = {},
  ) {
    serviceStartConfigSchema.parse(config)
  }

  // Resolves with where the service bound, who it is, and the bearer to reach it with — everything
  // the connection broker needs. The caller supplies the previously-remembered device token so the
  // service can reuse it instead of creating a new device row on every launch.
  async start(rememberedDeviceToken?: string): Promise<ServiceStartResult> {
    if (this.child) throw new Error('Service host is already started')
    this.stopping = false
    const child = spawn(process.execPath, [this.entry], {
      // ELECTRON_RUN_AS_NODE makes Electron's binary behave as `node`, so the child needs no system
      // Node install and keeps Electron's V8 — which is the ABI the bundled better-sqlite3/node-pty
      // are built against.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // stdin closed (the service never reads it); stdout/stderr inherited so its logs land wherever
      // the app's do; fd 3 is the IPC channel that gives the child `process.send`.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.child = child

    const transport: ServiceMessageTransport = {
      // Send can throw once the channel is gone (a crashed child between our exit handler running and
      // a caller's in-flight request). The peer's own timeout is the backstop, and a throw here would
      // surface as an unhandled rejection in whatever unrelated code happened to be sending.
      send: (message: ServiceMessage) => {
        try {
          child.send(message)
        } catch (error) {
          console.warn('[service-host] send failed; the service channel is gone:', error)
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
    this.disposeDesktopHandlers = registerDesktopCapabilityHandlers(peer)
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
      // 'error' is the spawn failure a utilityProcess reported as an immediate exit: a missing entry or
      // an unexecutable binary never reaches 'exit' at all, so without this the promise never settles.
      child.once('error', onEarlyExit)
    })
    child.on('exit', (code) => this.handleExit(child, code ?? 0))
    await spawned
    const result = await peer.request('service.start', { ...this.config, deviceToken: rememberedDeviceToken }, 60_000)
    // Parsed, not cast: this is the one place a malformed handoff would otherwise surface much later
    // as an unreachable node with no explanation.
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
      console.warn('[service-host] graceful stop failed:', error)
    }
    this.disposeConnection('Service stopped')
    this.terminate(child)
    this.child = null
  }

  // SIGTERM, then SIGKILL if it is ignored. The service installs its own SIGTERM handler to drain
  // cleanly, so the polite signal is the one that matters — but a wedged child holding the data root's
  // exclusive lock blocks the next launch, and commit 9dbb343 already taught this repo what happens when
  // nothing follows up a signal a child can ignore (a probe found alive as an orphan four days later).
  private terminate(child: ChildProcess): void {
    child.kill('SIGTERM')
    const escalate = setTimeout(() => child.kill('SIGKILL'), KILL_ESCALATION_MS)
    escalate.unref?.() // never the reason the app cannot quit
    child.once('exit', () => clearTimeout(escalate))
  }

  private handleExit(child: ChildProcess, code: number): void {
    if (this.child !== child) return
    const unexpected = !this.stopping
    this.child = null
    this.disposeConnection(`Service exited with code ${code}`)
    if (unexpected) this.events.unexpectedExit?.(code)
  }

  private disposeConnection(reason: string): void {
    this.disposeDesktopHandlers?.()
    this.disposeDesktopHandlers = null
    this.peer?.close(reason)
    this.peer = null
  }
}
