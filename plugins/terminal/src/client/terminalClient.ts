// Typed accessor for the client's PTY surface (docs/terminal.md): loopback HTTP for the
// session commands, the WebSocket for every stream (PTY input/output/status, workflow notices).
//
// PTY verbs only. Task lifecycle, per-repo checkout/config, preview URLs and agent delivery are
// platform concerns and live in client-core/features/tasks/taskBridge.ts.
import type { CreateOpts, ServerMsg, TerminalProfile, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import { terminalProfilesRoute, terminalSessionActionRoute, terminalSessionsRoute, terminalTaskSetupRoute } from '../shared/api'
import type { SendSubmit } from '../shared/send'
import { activeNodeId, readJson, writeJson, wsOnNotice, wsOnWorkflowStepEvent, type WorkflowNotice } from '@acorn/plugin-api/client'
import { wsAttach, wsRememberSize, wsWrite } from './wsChannel'

export type TerminalApi = {
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  send(id: string, text: string, submit: SendSubmit): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  /** Start the setup script in the task's worktree. A refusal rejects with the node's reason. */
  runSetup(taskId: string): Promise<{ sessionId: string }>
  write(id: string, data: string): void
  attach(id: string, on: (m: ServerMsg) => void, size?: { cols: number; rows: number }): () => void
  // Workflow commands use workflowClient's HTTP routes; notices and live step events use WebSocket.
  workflow: {
    onNotice(cb: (n: WorkflowNotice) => void): () => void
    onStepEvent(cb: (event: { runId: string; stepId: string; event: unknown }) => void): () => void
  }
}

// Always available: every verb here is an HTTP route or a WebSocket frame against the node. It used to
// return null unless the shell exposed a native folder picker, which is neither a PTY nor
// anything this file has an opinion about (the node-first platform seam design, in Git history). Whether the node
// runs terminals at all is `hasHostCapability({ plugin: 'terminal' })`, read from the node's plugin roster.
export const terminalApi = (nodeId: string | null = activeNodeId()): TerminalApi => {
  const post = <T>(url: string, body?: unknown) => writeJson<T>(url, { nodeId, method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return {
    list: () => readJson<TerminalSession[]>(terminalSessionsRoute, { nodeId }),
    profiles: () => readJson<TerminalProfile[]>(terminalProfilesRoute, { nodeId }),
    create: (opts) => post<TerminalSession>(terminalSessionsRoute, opts),
    kill: (id) => post<boolean>(terminalSessionActionRoute(id, 'kill')),
    interrupt: (id) => post<boolean>(terminalSessionActionRoute(id, 'interrupt')),
    remove: (id) => post<boolean>(terminalSessionActionRoute(id, 'remove')),
    resize: (id, cols, rows) => {
      wsRememberSize(id, cols, rows, nodeId)
      return post<boolean>(terminalSessionActionRoute(id, 'resize'), { cols, rows })
    },
    send: (id, text, submit) => post(terminalSessionActionRoute(id, 'send'), { text, submit }),
    runSetup: (taskId) => post<{ sessionId: string }>(terminalTaskSetupRoute(taskId)),
    write: (id, data) => wsWrite(id, data, nodeId),
    attach: (id, on, size) => wsAttach(id, on, size, nodeId),
    workflow: {
      onNotice: (cb) => wsOnNotice((notice) => { if (activeNodeId() === nodeId) cb(notice) }),
      onStepEvent: (cb) => wsOnWorkflowStepEvent((event) => { if (activeNodeId() === nodeId) cb(event) }),
    },
  }
}
