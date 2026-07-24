import { mkdtemp, mkdir, rm, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzeClaudeDailyUsage,
  claudeModelPrice,
  deduplicateClaudeUsage,
  parseClaudeUsageJsonl,
} from './claudeDailyUsage'

const roots: string[] = []
const now = new Date(2026, 6, 24, 15, 0, 0).getTime()

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const usageLine = (
  timestamp: number,
  over: {
    messageId?: string
    requestId?: string
    model?: string
    input?: number
    output?: number
    cacheWrite?: number
    cacheRead?: number
  } = {},
) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(timestamp).toISOString(),
    requestId: over.requestId ?? 'req-1',
    message: {
      id: over.messageId ?? 'msg-1',
      model: over.model ?? 'claude-sonnet-4-6',
      usage: {
        input_tokens: over.input ?? 10,
        output_tokens: over.output ?? 20,
        cache_creation_input_tokens: over.cacheWrite ?? 30,
        cache_read_input_tokens: over.cacheRead ?? 40,
      },
    },
  })

async function fixtureRoot(): Promise<{ root: string; project: string }> {
  const root = await mkdtemp(join(tmpdir(), 'acorn-claude-usage-'))
  roots.push(root)
  const project = join(root, 'projects', 'fixture')
  await mkdir(project, { recursive: true })
  return { root, project }
}

describe('Claude JSONL parsing and pricing', () => {
  it('reads only usage-bearing assistant messages and tolerates malformed lines', () => {
    const records = parseClaudeUsageJsonl(
      [usageLine(now), '{bad', JSON.stringify({ type: 'user' }), usageLine(now, { messageId: 'msg-2', input: 0 })].join('\n'),
    )
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      cacheWriteTokens: 30,
      cacheReadTokens: 40,
    })
  })

  it('deduplicates streamed usage by message and request with last record winning', () => {
    const records = parseClaudeUsageJsonl(
      [usageLine(now, { output: 4 }), usageLine(now + 1_000, { output: 9 }), usageLine(now, { messageId: 'msg-2', output: 3 })].join('\n'),
    )
    expect(deduplicateClaudeUsage(records).map((record) => record.outputTokens)).toEqual([9, 3])
  })

  it('matches current official model rates and refuses to price unknown models', () => {
    expect(claudeModelPrice('claude-opus-4-6')).toMatchObject({ input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 })
    expect(claudeModelPrice('claude-sonnet-5', new Date(2026, 6, 24).getTime())).toMatchObject({ input: 2, output: 10 })
    expect(claudeModelPrice('claude-sonnet-5', new Date(2026, 8, 2).getTime())).toMatchObject({ input: 3, output: 15 })
    expect(claudeModelPrice('future-unknown-model')).toBeNull()
  })
})

describe('analyzeClaudeDailyUsage', () => {
  it('aggregates today and yesterday with cache costs and 30-minute work-session gaps', async () => {
    const { root, project } = await fixtureRoot()
    const todayStart = new Date(2026, 6, 24).getTime()
    const yesterday = new Date(2026, 6, 23, 12).getTime()
    await writeFile(
      join(project, 'session.jsonl'),
      [
        usageLine(yesterday, { messageId: 'yesterday', input: 100 }),
        usageLine(todayStart + 60_000, { messageId: 'one', input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }),
        usageLine(todayStart + 11 * 60_000, { messageId: 'two', requestId: 'req-2', input: 0, output: 1_000_000, cacheWrite: 0, cacheRead: 0 }),
        usageLine(todayStart + 50 * 60_000, { messageId: 'three', requestId: 'req-3', input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 }),
      ].join('\n'),
    )

    const report = await analyzeClaudeDailyUsage(root, now)
    expect(report.today).toMatchObject({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      totalNonCacheTokens: 2_000_000,
      sessionCount: 2,
      workingSeconds: 600,
      estimatedCostUsd: 22.05,
      estimatedCacheSavingsUsd: 2.7,
      pricingFallback: false,
    })
    expect(report.yesterday?.inputTokens).toBe(100)
  })

  it('returns token totals but no money when any model has unknown pricing', async () => {
    const { root, project } = await fixtureRoot()
    await writeFile(join(project, 'unknown.jsonl'), usageLine(now, { model: 'claude-next-unknown', input: 50 }))
    const report = await analyzeClaudeDailyUsage(root, now)
    expect(report.today.totalNonCacheTokens).toBe(70)
    expect(report.today.pricingFallback).toBe(true)
    expect(report.today.estimatedCostUsd).toBeNull()
    expect(report.today.estimatedCacheSavingsUsd).toBeNull()
  })

  it('handles a missing root and skips old or oversized files', async () => {
    const { root, project } = await fixtureRoot()
    const old = join(project, 'old.jsonl')
    await writeFile(old, usageLine(now - 5 * 86_400_000))
    const oldDate = new Date(now - 5 * 86_400_000)
    await utimes(old, oldDate, oldDate)
    const oversized = join(project, 'oversized.jsonl')
    await writeFile(oversized, '')
    await truncate(oversized, 32 * 1024 * 1024 + 1)

    const report = await analyzeClaudeDailyUsage(root, now)
    expect(report.today.totalNonCacheTokens).toBe(0)
    expect(report.skippedFileCount).toBe(1)

    const missing = await analyzeClaudeDailyUsage(join(root, 'missing'), now)
    expect(missing.today.totalNonCacheTokens).toBe(0)
    expect(missing.skippedFileCount).toBe(1)
  })
})
