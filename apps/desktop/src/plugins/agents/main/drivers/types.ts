import type {
  AgentConfigOption,
  AgentInputPart,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentTurn,
} from '../../../../core/shared/managedAgents'

export type AgentDriverStartOptions = {
  session: AgentSession
  cwd: string
  env: Record<string, string>
  noProviderExecutionHistory: boolean
  onEvent(event: AgentNormalizedEvent): void | Promise<void>
  onClosed(error?: Error): void | Promise<void>
}

export type AgentDriverTurnOptions = {
  turn: AgentTurn
  input: AgentInputPart[]
  attachments: Record<string, {
    id: string
    filename: string
    mediaType: string
    byteSize: number
    localPath: string
  }>
}

export interface AgentDriverSession {
  readonly providerSessionRef: string | null
  readonly ready: boolean
  sendTurn(options: AgentDriverTurnOptions): Promise<{ providerTurnRef?: string }>
  cancel(): Promise<void>
  resolveRequest(providerRequestId: string, resolution: unknown): Promise<void>
  setConfig?(optionId: string, value: string): Promise<AgentConfigOption[] | void>
  fork?(): Promise<string>
  compact?(): Promise<void>
  archive?(archived: boolean): Promise<void>
  delete?(): Promise<void>
  stop(): Promise<void>
}

export interface AgentDriver {
  readonly providerId: string
  readonly profileId: string
  probe(): Promise<AgentProviderDescriptor>
  start(options: AgentDriverStartOptions): Promise<AgentDriverSession>
  classifyTurnFailure?(error: unknown): 'safe_transient' | 'uncertain' | 'permanent'
}

export type AgentDriverFactory = () => AgentDriver
