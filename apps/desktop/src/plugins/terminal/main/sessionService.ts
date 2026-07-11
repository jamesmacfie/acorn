import type { z } from 'zod'
import type { CreateOpts, TerminalSession } from '../../../core/shared/terminal'
import type { SendSubmit } from '../server/routes/terminal'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type {
  AgentSendResultSchema,
  CreateTerminalSessionSchema,
  McpInspectSchema,
  McpStarterResultSchema,
  SessionsQuerySchema,
  TerminalSessionSchema,
} from '../../../core/shared/publicApi/terminal'
import { terminalBridgeSlot } from '../server/routes/terminal'

// Interactive terminal sessions (docs/public-api.md). Thin adapter over the
// engine's TerminalBridge (the same one the internal routes use). Raw commands are never exposed —
// only the profile/title label. Streaming stays on the WebSocket; this is the resource surface.

type PublicSession = z.infer<typeof TerminalSessionSchema>

// Project an engine TerminalSession onto the public shape (raw command never exposed). Shared with
// the public WS hub's terminal.ready frame.
export function toPublicSession(s: TerminalSession): PublicSession {
  return {
    id: s.id,
    taskId: s.taskId,
    title: s.title,
    kind: s.kind,
    profileId: s.profileId,
    backend: s.backend,
    status: s.status,
    idle: s.idle,
    agentState: s.agentState,
    isWorktree: s.isWorktree,
    cwd: s.cwd,
    commandLabel: s.title,
    ...(s.tmuxSession ? { tmuxSession: s.tmuxSession } : {}),
    ...(s.repo ? { repo: s.repo } : {}),
    ...(s.pull ? { pull: s.pull } : {}),
    cols: s.cols,
    rows: s.rows,
    createdAt: s.createdAt,
    exitedAt: null,
    exitCode: s.exitCode,
  }
}

export class TerminalSessionService {
  private bridge() {
    const b = terminalBridgeSlot.get()
    if (!b) throw new PublicApiError('capability_unavailable', 'Terminal engine is not available')
    return b
  }

  private toPublic(s: TerminalSession): PublicSession {
    return toPublicSession(s)
  }

  async list(filter: z.infer<typeof SessionsQuerySchema>): Promise<PublicSession[]> {
    let sessions = await this.bridge().list()
    if (filter.taskId) sessions = sessions.filter((s) => s.taskId === filter.taskId)
    if (filter.status) sessions = sessions.filter((s) => s.status === filter.status)
    if (filter.kind) sessions = sessions.filter((s) => s.kind === filter.kind)
    return sessions.slice(0, filter.limit).map((s) => this.toPublic(s))
  }

  async get(sessionId: string): Promise<PublicSession> {
    const s = (await this.bridge().list()).find((x) => x.id === sessionId)
    if (!s) throw new PublicApiError('not_found', 'Session not found')
    return this.toPublic(s)
  }

  async create(taskId: string, input: z.infer<typeof CreateTerminalSessionSchema>): Promise<PublicSession> {
    const opts: CreateOpts =
      input.launch === 'profile'
        ? { taskId, profileId: input.profileId, title: input.title, cols: input.cols, rows: input.rows }
        : { taskId, command: input.command, env: input.env, title: input.title, cols: input.cols, rows: input.rows }
    return this.toPublic(await this.bridge().create(opts))
  }

  async interrupt(sessionId: string): Promise<PublicSession> {
    if (!(await this.bridge().interrupt(sessionId))) throw new PublicApiError('conflict', 'Session is not running')
    return this.get(sessionId)
  }

  async kill(sessionId: string): Promise<PublicSession> {
    if (!(await this.bridge().kill(sessionId))) throw new PublicApiError('not_found', 'Session not found')
    return this.get(sessionId)
  }

  async remove(sessionId: string, force: boolean): Promise<void> {
    // A running session requires force (session_running otherwise, §3).
    const s = (await this.bridge().list()).find((x) => x.id === sessionId)
    if (s && s.status === 'running' && !force) throw new PublicApiError('session_running', 'Session is running; pass force=true')
    await this.bridge().remove(sessionId)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<PublicSession> {
    if (!(await this.bridge().resize(sessionId, cols, rows))) throw new PublicApiError('not_found', 'Session not found')
    return this.get(sessionId)
  }

  async send(sessionId: string, text: string, submit: SendSubmit): Promise<z.infer<typeof AgentSendResultSchema>> {
    const res = await this.bridge().sendToAgent(sessionId, text, submit)
    return { sent: res.ok, queued: res.queued ?? false, ...(res.reason ? { reason: res.reason } : {}) }
  }

  async mcpInspect(taskId: string): Promise<z.infer<typeof McpInspectSchema>> {
    const files = await this.bridge().mcpInspect(taskId)
    return {
      files: files.map((f) => ({
        file: f.file,
        // envKeys only — never the values (§5).
        servers: f.servers.map((s) => ({ name: s.name, transport: s.transport, status: s.status, ...(s.command ? { command: s.command } : {}), ...(s.url ? { url: s.url } : {}), envKeys: Object.keys(s.env ?? {}) })),
      })),
    }
  }

  async mcpStarter(taskId: string): Promise<z.infer<typeof McpStarterResultSchema>> {
    const res = await this.bridge().mcpCreateStarter(taskId)
    return { created: res.ok, ...(res.reason ? { reason: res.reason } : {}) }
  }
}
