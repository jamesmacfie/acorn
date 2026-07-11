import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { ERROR_STATUS, type ErrorCode, PublicApiError } from '../../shared/publicApi/errors'
import type { CommandResultSchema } from '../../shared/publicApi/commands'
import type { WsServerFrame } from '../../shared/ws'
import type { UiControlBroker as UiControlBrokerContract } from '../../server/publicApi/coreCommands'

// UI control broker (docs/next/api/architecture.md §3.4, commands-and-ui.md §4). One control
// connection per window on the internal 4317 socket. The renderer registers after startup restore
// and reports a serializable snapshot; presentation commands cross here to the live renderer and
// their acknowledgements come back correlated by requestId. Not a second state store — the renderer
// remains the writer.

type CommandResult = z.infer<typeof CommandResultSchema>

const COMMAND_TIMEOUT_MS = 5000

type Renderer = {
  windowId: string
  primary: boolean
  snapshot: unknown
  revision: number
  send: (frame: Extract<WsServerFrame, { channel: 'ui:command' }>) => void
}

type Pending = {
  resolve: (result: CommandResult) => void
  reject: (err: PublicApiError) => void
  timer: ReturnType<typeof setTimeout>
  commandId: string
  windowId: string
  acceptedAt: number
}

function revisionOf(snapshot: unknown): number {
  const r = (snapshot as { revision?: unknown })?.revision
  return typeof r === 'number' ? r : 0
}

export class UiControlBroker implements UiControlBrokerContract {
  private readonly renderers = new Map<string, Renderer>()
  private readonly pending = new Map<string, Pending>()

  register(windowId: string, primary: boolean, snapshot: unknown, send: Renderer['send']): void {
    this.renderers.set(windowId, { windowId, primary, snapshot, revision: revisionOf(snapshot), send })
  }

  updateState(windowId: string, snapshot: unknown): void {
    const r = this.renderers.get(windowId)
    if (r) {
      r.snapshot = snapshot
      r.revision = revisionOf(snapshot)
    }
  }

  disconnect(windowId: string): void {
    this.renderers.delete(windowId)
    // Fail any pending commands targeting this window (renderer disconnect fails promptly, §9).
    for (const [requestId, p] of this.pending) {
      if (p.windowId === windowId) {
        clearTimeout(p.timer)
        p.reject(new PublicApiError('ui_unavailable', 'The target window disconnected'))
        this.pending.delete(requestId)
      }
    }
  }

  // Resolve the target window: an explicit id, else the primary, else any single renderer.
  private target(windowId?: string): Renderer | null {
    if (windowId) return this.renderers.get(windowId) ?? null
    for (const r of this.renderers.values()) if (r.primary) return r
    return this.renderers.size === 1 ? [...this.renderers.values()][0] : null
  }

  snapshots(): { windowId: string; primary: boolean; snapshot: unknown }[] {
    return [...this.renderers.values()].map((r) => ({ windowId: r.windowId, primary: r.primary, snapshot: r.snapshot }))
  }

  snapshot(windowId?: string): unknown | null {
    return this.target(windowId)?.snapshot ?? null
  }

  get rendererConnected(): boolean {
    return this.renderers.size > 0
  }

  // The UiControlBroker interface used by the command dispatch.
  invoke(input: { commandId: string; input: unknown; windowId?: string; expectedRevision?: number }): Promise<CommandResult> {
    const renderer = this.target(input.windowId)
    if (!renderer) throw new PublicApiError('ui_unavailable', 'No renderer is connected')
    if (input.expectedRevision !== undefined && input.expectedRevision !== renderer.revision) {
      throw new PublicApiError('presentation_revision_conflict', `Presentation revision is ${renderer.revision}`, { details: { revision: renderer.revision } })
    }
    const requestId = randomUUID()
    const acceptedAt = Date.now()
    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new PublicApiError('ui_command_timeout', 'The renderer did not acknowledge in time'))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer, commandId: input.commandId, windowId: renderer.windowId, acceptedAt })
      renderer.send({ channel: 'ui:command', requestId, windowId: renderer.windowId, commandId: input.commandId, input: input.input, expectedRevision: input.expectedRevision })
    })
  }

  // Called by the WS hub when a ui:command-result frame arrives.
  resolveResult(frame: { requestId: string; ok: boolean; result?: unknown; error?: { code: string; message: string; details?: unknown }; revision: number }): void {
    const p = this.pending.get(frame.requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(frame.requestId)
    const renderer = this.renderers.get(p.windowId)
    if (renderer) renderer.revision = frame.revision
    if (frame.ok) {
      p.resolve({ commandId: p.commandId, targetWindowId: p.windowId, acceptedAt: p.acceptedAt, completedAt: Date.now(), presentationRevision: frame.revision, result: frame.result })
    } else {
      const err = frame.error ?? { code: 'command_unavailable', message: 'Command failed' }
      // Trust a known public error code from the renderer; otherwise treat it as unavailable.
      const code: ErrorCode = err.code in ERROR_STATUS ? (err.code as ErrorCode) : 'command_unavailable'
      p.reject(new PublicApiError(code, err.message, { details: err.details }))
    }
  }
}
