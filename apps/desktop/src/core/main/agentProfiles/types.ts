import type { Launcher } from '../mcpRegister'

export type HeadlessArgv = { file: string; args: string[] }

export type HeadlessOpts = {
  prompt: string
  model?: string
  schema?: object
  resumeSessionId?: string
}

export type StreamEvent = Record<string, unknown> & { type?: string }

export type HeadlessCapture = {
  result: string | null
  structuredOutput: unknown | null
  sessionId: string | null
  costUsd: number | null
  events: StreamEvent[]
}

export type StreamJsonAdapter = {
  parse(stdout: string): HeadlessCapture
  parseLine(line: string): StreamEvent | null
}

export type AgentProfileContribution = {
  id: string
  label: string
  kind: 'shell' | 'agent'
  command: string
  backendPreference: 'node-pty' | 'tmux'
  transport: 'pty'
  mcpRegistration?: (name: string, launcher: Launcher) => Promise<{ ok: boolean; reason?: string }>
  headlessArgv?: (command: string, opts: HeadlessOpts) => HeadlessArgv
  resumeArgv?: (command: string, sessionRef: string) => HeadlessArgv
  aiArgv?: (command: string, opts: HeadlessOpts) => HeadlessArgv
  streamJson?: StreamJsonAdapter
}

