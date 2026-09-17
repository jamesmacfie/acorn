import type { ModelCatalogEntry } from '@acorn/protocol/integrations.ts'
import type { Launcher } from '../mcpRegister'

export type HeadlessArgv = { file: string; args: string[] }

export type HeadlessOpts = {
  prompt: string
  model?: string
  schema?: object
  resumeSessionId?: string
  // The system half of a one-shot generate, kept apart from the prompt because that is how the
  // connection runtime and every caller's prompt builder already separate them. The profile decides
  // how to carry it: a flag when its CLI has one, prepended to the prompt when it does not. Core never
  // concatenates on a profile's behalf, because only the profile knows whether the flag was honoured.
  system?: string
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
  // Extra argv for the interactive launch (docs/notes-and-memory.md § Context integration).
  launchArgs?: string[]
  // Whether `command` can be opened as a terminal. Omitted means yes, which is every built-in profile:
  // a shell, and three agent CLIs that all run interactively. `false` is for a profile that exists only
  // to answer one prompt, where running `command` bare would fail in front of whoever picked it. The
  // terminal's profile menu leaves those out (../profiles.ts) and the spawn route refuses them.
  interactive?: boolean
  headlessArgv?: (command: string, opts: HeadlessOpts) => HeadlessArgv
  resumeArgv?: (command: string, sessionRef: string) => HeadlessArgv
  // Declaring this is the opt-in for text generation, not just for a workflow `decide` step: a profile
  // that can decide can also generate, so `models.available()` lists it beside every connected API key
  // (docs/integrations.md § Model providers). One field, no second registry.
  aiArgv?: (command: string, opts: HeadlessOpts) => HeadlessArgv
  streamJson?: StreamJsonAdapter
  // The same two fields a connection provider declares, for the same reason: a picker needs a model
  // list and a starting point. Omitted means the CLI's own configured default, and the picker hides its
  // model select — what it already does for a provider with no catalog.
  models?: ModelCatalogEntry[]
  defaultModelId?: string
  // A Lucide name or a `brand:` mark, for the Settings list and the wizard.
  glyph?: string
}
