import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentDailyUsage, AgentDailyUsagePeriod } from '../../shared/usage'
import {
  claudeModelPrice,
  emptyAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_FILES = 2_000
const SESSION_GAP_MS = 30 * 60 * 1_000
const MILLION = 1_000_000

type TokenUsageRecord = {
  messageId: string | null
  requestId: string | null
  model: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  timestamp: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function finiteToken(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function parseRecord(line: string): TokenUsageRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const root = asObject(parsed)
  if (root?.type !== 'assistant' || typeof root.timestamp !== 'string') return null
  const message = asObject(root.message)
  const usage = asObject(message?.usage)
  if (!message || !usage || typeof message.model !== 'string') return null
  const timestamp = Date.parse(root.timestamp)
  if (!Number.isFinite(timestamp)) return null
  return {
    messageId: typeof message.id === 'string' ? message.id : null,
    requestId: typeof root.requestId === 'string' ? root.requestId : null,
    model: message.model,
    inputTokens: finiteToken(usage.input_tokens),
    outputTokens: finiteToken(usage.output_tokens),
    cacheWriteTokens: finiteToken(usage.cache_creation_input_tokens),
    cacheReadTokens: finiteToken(usage.cache_read_input_tokens),
    timestamp,
  }
}

export function parseClaudeUsageJsonl(content: string): TokenUsageRecord[] {
  return content
    .split(/\r?\n/)
    .map(parseRecord)
    .filter((record): record is TokenUsageRecord => record !== null)
}

export function deduplicateClaudeUsage(records: readonly TokenUsageRecord[]): TokenUsageRecord[] {
  const keyed = new Map<string, TokenUsageRecord>()
  const order: string[] = []
  let unkeyed = 0
  for (const record of records) {
    const key =
      record.messageId && record.requestId
        ? `${record.messageId}\u0000${record.requestId}`
        : `unkeyed:${unkeyed++}`
    if (!keyed.has(key)) order.push(key)
    keyed.set(key, record)
  }
  return order.flatMap((key) => {
    const record = keyed.get(key)
    return record ? [record] : []
  })
}

function localDay(at: number): string {
  const date = new Date(at)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayStart(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function aggregate(
  records: readonly TokenUsageRecord[],
  at: number,
  pricing: AgentPricingPreferences,
): AgentDailyUsagePeriod {
  const sorted = [...records].sort((left, right) => left.timestamp - right.timestamp)
  let inputTokens = 0
  let outputTokens = 0
  let cacheWriteTokens = 0
  let cacheReadTokens = 0
  let estimatedCostUsd = 0
  let estimatedCacheSavingsUsd = 0
  let pricingFallback = false
  const unpricedModels = new Set<string>()

  for (const record of sorted) {
    inputTokens += record.inputTokens
    outputTokens += record.outputTokens
    cacheWriteTokens += record.cacheWriteTokens
    cacheReadTokens += record.cacheReadTokens
    const price = claudeModelPrice(record.model, record.timestamp, pricing)
    if (!price) {
      pricingFallback = true
      unpricedModels.add(record.model)
      continue
    }
    estimatedCostUsd +=
      (record.inputTokens * price.input +
        record.outputTokens * price.output +
        record.cacheWriteTokens * price.cacheWrite +
        record.cacheReadTokens * price.cacheRead) /
      MILLION
    estimatedCacheSavingsUsd += (record.cacheReadTokens * (price.input - price.cacheRead)) / MILLION
  }

  let workingSeconds = 0
  let sessionCount = sorted.length > 0 ? 1 : 0
  let sessionStart = sorted[0]?.timestamp ?? 0
  let lastTimestamp = sessionStart
  for (const record of sorted.slice(1)) {
    if (record.timestamp - lastTimestamp > SESSION_GAP_MS) {
      workingSeconds += Math.max(0, lastTimestamp - sessionStart) / 1_000
      sessionStart = record.timestamp
      sessionCount += 1
    }
    lastTimestamp = record.timestamp
  }
  if (sorted.length > 0) workingSeconds += Math.max(0, lastTimestamp - sessionStart) / 1_000

  return {
    day: localDay(at),
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalNonCacheTokens: inputTokens + outputTokens,
    workingSeconds,
    sessionCount,
    estimatedCostUsd: pricingFallback ? null : estimatedCostUsd,
    estimatedCacheSavingsUsd: pricingFallback ? null : estimatedCacheSavingsUsd,
    pricingFallback,
    unpricedModels: [...unpricedModels].sort(),
  }
}

async function recentJsonlFiles(root: string, since: number): Promise<{ files: string[]; skipped: number }> {
  const files: string[] = []
  let skipped = 0

  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      skipped += 1
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        skipped += 1
        return
      }
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const metadata = await stat(path)
          if (metadata.mtimeMs >= since && metadata.size <= MAX_FILE_BYTES) files.push(path)
          else if (metadata.mtimeMs >= since) skipped += 1
        } catch {
          skipped += 1
        }
      }
    }
  }

  await visit(root)
  return { files, skipped }
}

export async function analyzeClaudeDailyUsage(
  claudeDir: string,
  now = Date.now(),
  pricing = emptyAgentPricingPreferences(),
): Promise<AgentDailyUsage> {
  const todayStart = dayStart(now)
  const yesterdayStart = new Date(
    new Date(todayStart).getFullYear(),
    new Date(todayStart).getMonth(),
    new Date(todayStart).getDate() - 1,
  ).getTime()
  const scan = await recentJsonlFiles(join(claudeDir, 'projects'), yesterdayStart)
  const records: TokenUsageRecord[] = []
  let skippedFileCount = scan.skipped
  for (const file of scan.files) {
    try {
      records.push(...parseClaudeUsageJsonl(await readFile(file, 'utf8')))
    } catch {
      skippedFileCount += 1
    }
  }
  const deduplicated = deduplicateClaudeUsage(records)
  const todayKey = localDay(todayStart)
  const yesterdayKey = localDay(yesterdayStart)
  const today = deduplicated.filter((record) => localDay(record.timestamp) === todayKey)
  const yesterday = deduplicated.filter((record) => localDay(record.timestamp) === yesterdayKey)
  return {
    today: aggregate(today, todayStart, pricing),
    yesterday: aggregate(yesterday, yesterdayStart, pricing),
    skippedFileCount,
  }
}
