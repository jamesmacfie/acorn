// The host can present Terminal sessions after this plugin activates. The contract contains only
// the narrow presentation interface; Terminal's client owns its transport, roster, and PTY channel.
import type { CreateOpts, ServerMsg, TerminalProfile, TerminalSession } from './wire'

export type TerminalHostApi = {
  profiles(): Promise<TerminalProfile[]>
  create(options: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  attach(id: string, on: (message: ServerMsg) => void, size?: { cols: number; rows: number }): () => void
  write(id: string, data: string): void
}

export type TerminalHostClient = {
  api: TerminalHostApi
  sessions(): TerminalSession[]
  sessionNode(): string | null
  refreshSessions(): Promise<void>
  activeTerminal(taskId: string): string | undefined
  rememberActiveTerminal(taskId: string, sessionId: string): void
}

let current: TerminalHostClient | null = null

export function installTerminalHostClient(client: TerminalHostClient): () => void {
  current = client
  return () => { if (current === client) current = null }
}

function installed(): TerminalHostClient {
  if (!current) throw new Error('The Terminal plugin is not active on this client.')
  return current
}

export const terminalApi = (): TerminalHostApi => installed().api
export const sessions = (): TerminalSession[] => installed().sessions()
export const sessionNode = (): string | null => installed().sessionNode()
export const refreshSessions = (): Promise<void> => installed().refreshSessions()
export const activeTerminal = (taskId: string): string | undefined => installed().activeTerminal(taskId)
export const rememberActiveTerminal = (taskId: string, sessionId: string): void =>
  installed().rememberActiveTerminal(taskId, sessionId)
