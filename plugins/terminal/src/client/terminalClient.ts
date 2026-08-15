// Typed accessor for the renderer's PTY surface (docs/terminal-and-agents.md): loopback HTTP for the
// session commands, the WebSocket for every stream (PTY input/output/status, workflow notices).
//
// PTY verbs only. Task lifecycle, per-repo checkout/config, preview URLs and agent delivery are
// platform concerns and live in client-core/tasks/taskBridge.ts.
import type { CreateOpts, ServerMsg, TerminalProfile, TerminalSession } from '@acorn/protocol/terminal.ts'
import { terminalProfilesRoute, terminalSessionActionRoute, terminalSessionsRoute } from '../contract/routes'
import { readJson, writeJson, wsAttach, wsOnNotice, wsOnStatus, wsOnWorkflowStepEvent, wsWrite } from '@acorn/plugin-api/client'

export type TerminalApi = {
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  write(id: string, data: string): void
  onStatus(cb: () => void): () => void
  attach(id: string, on: (m: ServerMsg) => void): () => void
  // Workflow commands use workflowClient's HTTP routes; notices and live step events use WebSocket.
  workflow: {
    onNotice(cb: (n: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' }) => void): () => void
    onStepEvent(cb: (event: { runId: string; stepId: string; event: unknown }) => void): () => void
  }
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

// Always available: every verb here is an HTTP route or a WebSocket frame against the node. It used to
// return null unless Electron's preload exposed a native folder picker, which is neither a PTY nor
// anything this file has an opinion about (docs/future/node-first/platform-seam.md). Whether the node
// runs terminals at all is `capabilities().terminal`, read from the node's plugin roster.
export const terminalApi = (): TerminalApi => {
  return {
    list: () => readJson<TerminalSession[]>(terminalSessionsRoute),
    profiles: () => readJson<TerminalProfile[]>(terminalProfilesRoute),
    create: (opts) => post<TerminalSession>(terminalSessionsRoute, opts),
    kill: (id) => post<boolean>(terminalSessionActionRoute(id, 'kill')),
    interrupt: (id) => post<boolean>(terminalSessionActionRoute(id, 'interrupt')),
    remove: (id) => post<boolean>(terminalSessionActionRoute(id, 'remove')),
    resize: (id, cols, rows) => post<boolean>(terminalSessionActionRoute(id, 'resize'), { cols, rows }),
    write: wsWrite,
    onStatus: wsOnStatus,
    attach: wsAttach,
    workflow: { onNotice: wsOnNotice, onStepEvent: wsOnWorkflowStepEvent },
  }
}
