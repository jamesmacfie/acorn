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
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
  }
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
  // Extra argv for the INTERACTIVE launch (docs/notes-and-memory.md). A profile that can be told at
  // launch to fetch its own task context sets this; that standing instruction can't lose a race with
  // the user's first message, so such a profile gets no pushed launch-context block (terminal.ts).
  launchArgs?: string[]
  headlessArgv?: (command: string, opts: HeadlessOpts) => HeadlessArgv
  resumeArgv?: (command: string, sessionRef: string) => HeadlessArgv
  aiArgv?: (command: string, opts: HeadlessOpts) => HeadlessArgv
  streamJson?: StreamJsonAdapter
}
