// The public, JSON-safe payload of `agents:session-header`. Keep this structural copy beside the
// plugin so its production bundle depends on the published plugin SDK, not Acorn's source tree.
export type SessionHeaderUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  cost?: { amount: number; currency: string }
}

export type SessionHeaderTokenPrice = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export type SessionHeaderTurn = {
  turnId: string
  model: string | null
  usage: SessionHeaderUsage
  price: SessionHeaderTokenPrice | null
}

export type SessionHeaderProps = {
  taskId: string
  sessionId: string
  providerId: string
  tokenAccounting: 'per-turn' | 'cumulative'
  costAccounting: 'per-turn' | 'cumulative'
  turns: SessionHeaderTurn[]
}
