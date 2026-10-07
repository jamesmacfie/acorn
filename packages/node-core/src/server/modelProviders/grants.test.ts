import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { schema } from '../db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import type { GenerateTextRequest, ModelService } from '../core/models'
import { ProviderOperationError } from '../integrations/types'
import { chargeInterruptedModelCalls } from './grantSchema'
import {
  dayUsage, HARNESS_CALL_ESTIMATE, localDay, modelGrantProblem, modelGrantState,
  pluginModelService, reserveModelCall, settleModelCall, writeModelGrant,
} from './grants'

const OWNER = 'owner-1'
const PLUGIN = 'acorn-advisor'
const KEY = 'connection:key-1'
const CLI = 'harness:claude-code'
const input = { system: 'Review.', prompt: 'The turn.', maxOutputTokens: 300 }
const backends: ModelBackend[] = [
  { id: KEY, kind: 'connection', label: 'Anthropic', models: [{ id: 'haiku', label: 'Haiku' }], defaultModelId: 'haiku' },
  { id: CLI, kind: 'harness', label: 'Claude Code', models: [], defaultModelId: '' },
]

describe('plugin model grants', () => {
  let t: TestDb
  let generate: ReturnType<typeof vi.fn<(request: GenerateTextRequest) => ReturnType<ModelService['generateText']>>>
  let facet: ReturnType<typeof pluginModelService>
  const today = () => dayUsage(t.db, OWNER, PLUGIN, localDay(Date.now()))
  const rows = () => t.db.select().from(schema.pluginModelCalls).all()

  beforeEach(() => {
    t = makeTestDb()
    generate = vi.fn(async (request: GenerateTextRequest) => ({
      text: '{"severity":"none"}', providerId: 'anthropic', backendId: request.backendId, modelId: request.input.modelId ?? 'default',
      usage: { inputTokens: 900, outputTokens: 40 },
    }))
    facet = pluginModelService(t.db, { generateText: generate, available: async () => backends }, { active: () => OWNER }, PLUGIN)
  })

  it('refuses a call with no grant, a spoofed owner, or no owner, before any provider runs', async () => {
    await expect(facet.generateText({ userId: OWNER, input })).rejects.toMatchObject({ code: 'provider_not_configured', status: 400 })
    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: KEY, modelId: 'haiku', dailyOutputTokens: 10_000 })
    await expect(facet.generateText({ userId: 'someone-else', input })).rejects.toMatchObject({ code: 'provider_bad_config' })
    const ownerless = pluginModelService(t.db, { generateText: generate, available: async () => [] }, { active: () => null }, PLUGIN)
    await expect(ownerless.generateText({ userId: OWNER, input })).rejects.toMatchObject({ code: 'provider_not_configured' })
    // Another plugin's facet can't spend this plugin's grant.
    const other = pluginModelService(t.db, { generateText: generate, available: async () => [] }, { active: () => OWNER }, 'other-plugin')
    await expect(other.generateText({ userId: OWNER, input })).rejects.toMatchObject({ code: 'provider_not_configured' })
    expect(generate).not.toHaveBeenCalled()
    expect(rows()).toEqual([])
  })

  it('spends the grant\'s backend and model, and charges what the connection reports', async () => {
    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: KEY, modelId: 'haiku', dailyOutputTokens: 10_000 })
    await facet.generateText({ userId: OWNER, input })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ backendId: KEY, input: expect.objectContaining({ modelId: 'haiku' }) }))
    expect(today()).toMatchObject({ spent: 40, reserved: 0, calls: 1, reportedOutputTokens: 40 })
    // The owner picked the model. A plugin naming another one is refused rather than quietly overridden.
    await expect(facet.generateText({ userId: OWNER, input: { ...input, modelId: 'opus' } })).rejects.toMatchObject({ code: 'provider_bad_config' })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('leaves a call that names its backend alone, and records it apart from the allowance', async () => {
    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: KEY, modelId: 'haiku', dailyOutputTokens: 1 })
    await facet.generateText({ userId: OWNER, backendId: CLI, input: { ...input, modelId: 'sonnet' } })
    expect(generate).toHaveBeenCalledWith({ userId: OWNER, backendId: CLI, input: { ...input, modelId: 'sonnet' } })
    expect(today()).toMatchObject({ spent: 0, calls: 0, explicitCalls: 1, explicitReportedOutputTokens: 40 })
  })

  it('admits concurrent calls only up to the allowance', async () => {
    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: KEY, modelId: '', dailyOutputTokens: 1_000 })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    generate.mockImplementation(async (request) => {
      await gate
      return { text: 'ok', providerId: 'anthropic', backendId: request.backendId, modelId: 'haiku', usage: { outputTokens: 300 } }
    })
    const calls = Array.from({ length: 5 }, () => facet.generateText({ userId: OWNER, input }))
    // Three 300-token reservations fit in 1,000. While they're open, they count in full.
    expect(today()).toMatchObject({ spent: 900, reserved: 900 })
    release()
    const results = await Promise.allSettled(calls)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason))
      .toEqual([expect.objectContaining({ code: 'provider_budget_exhausted', status: 429 }), expect.objectContaining({ code: 'provider_budget_exhausted' })])
    expect(generate).toHaveBeenCalledTimes(3)
    expect(modelGrantState(t.db, OWNER, PLUGIN, backends).status).toBe('ready')
  })

  it('never replenishes the allowance for missing usage, an ambiguous failure, or a CLI report', async () => {
    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: KEY, modelId: '', dailyOutputTokens: 100_000 })
    generate.mockResolvedValueOnce({ text: 'ok', providerId: 'anthropic', backendId: KEY, modelId: 'haiku' })
    await facet.generateText({ userId: OWNER, input })
    expect(today().spent).toBe(300)

    generate.mockRejectedValueOnce(new ProviderOperationError('provider_unavailable', 502))
    await expect(facet.generateText({ userId: OWNER, input })).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(today().spent).toBe(600)

    // A connection removed since the grant was saved is refused before anything is generated.
    generate.mockRejectedValueOnce(new ProviderOperationError('provider_not_connected', 404))
    await expect(facet.generateText({ userId: OWNER, input })).rejects.toMatchObject({ code: 'provider_not_connected' })
    expect(today().spent).toBe(600)

    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: CLI, modelId: '', dailyOutputTokens: 100_000 })
    generate.mockResolvedValueOnce({ text: 'ok', providerId: 'claude-code', backendId: CLI, modelId: 'sonnet', usage: { outputTokens: 12 } })
    await facet.generateText({ userId: OWNER, input })
    expect(today()).toMatchObject({ spent: 600 + HARNESS_CALL_ESTIMATE, reportedOutputTokens: 12 })
  })

  it('charges a reservation an earlier process left open, and keeps a call on the day it was admitted', () => {
    const lastMinute = new Date(2026, 9, 7, 23, 59).getTime()
    const id = reserveModelCall(t.db, { ownerId: OWNER, pluginId: PLUGIN, backendId: KEY, units: 500, dailyOutputTokens: 1_000, now: lastMinute })
    reserveModelCall(t.db, { ownerId: OWNER, pluginId: PLUGIN, backendId: KEY, units: 400, dailyOutputTokens: 1_000, now: lastMinute })
    // The restart: neither call can settle now, and either may have spent.
    chargeInterruptedModelCalls(t.db, lastMinute + 60_000)
    settleModelCall(t.db, id, 10)
    expect(dayUsage(t.db, OWNER, PLUGIN, '2026-10-07')).toMatchObject({ spent: 900, reserved: 0 })
    expect(dayUsage(t.db, OWNER, PLUGIN, '2026-10-08')).toMatchObject({ spent: 0, calls: 0 })
    expect(() => reserveModelCall(t.db, { ownerId: OWNER, pluginId: PLUGIN, backendId: KEY, units: 101, dailyOutputTokens: 1_000, now: lastMinute }))
      .toThrow(expect.objectContaining({ code: 'provider_budget_exhausted' }))
  })

  it('says why a grant is unusable, and refuses to save one the Node can\'t run', () => {
    expect(modelGrantState(t.db, OWNER, PLUGIN, backends).status).toBe('unconfigured')
    writeModelGrant(t.db, OWNER, PLUGIN, { backendId: 'connection:gone', modelId: '', dailyOutputTokens: 10 })
    expect(modelGrantState(t.db, OWNER, PLUGIN, backends).status).toBe('backend-missing')
    expect(modelGrantProblem({ backendId: 'connection:gone', modelId: '', dailyOutputTokens: 10 }, backends)).toMatch(/isn't available/)
    expect(modelGrantProblem({ backendId: KEY, modelId: 'opus', dailyOutputTokens: 10 }, backends)).toMatch(/no model named opus/)
    expect(modelGrantProblem({ backendId: CLI, modelId: '', dailyOutputTokens: 10 }, backends)).toBeNull()
  })
})
