import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HARNESS_BACKEND_PREFIX } from '@acorn/protocol/modelProviders.ts'
import { agentProfileRegistry } from '../../main/agentProfiles'
import { AGENT_TOOL_PASSTHROUGH } from '../../main/agentProfiles/toolEnv'
import type { StreamEvent } from '../../main/agentProfiles/types'
import { brokerEnv } from '../../main/core/proc'
import { runHeadless } from '../../main/headless'
import { profileAvailable, resolveCommand } from '../../main/profiles'
import { providerRequestScheduler, type ProviderRequestScheduler } from '../integrations/budgetRuntime'
import { ProviderOperationError } from '../integrations/types'
import { DEFAULT_TIMEOUT_MS, validateInput } from './runtime'
import type { GenerateTextInput, GenerateTextResult } from './types'

const HARNESS_BUDGETS = { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 2 }

export type GenerateTextForHarnessArgs = {
  profileId: string
  input: GenerateTextInput
  timeoutMs?: number
}

/** Run one tool-disabled CLI turn in an empty temporary directory. */
export async function generateTextForHarness(
  args: GenerateTextForHarnessArgs,
  scheduler: ProviderRequestScheduler = providerRequestScheduler,
): Promise<GenerateTextResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  validateInput(args.input, timeoutMs)
  const profile = agentProfileRegistry.get(args.profileId)
  if (!profile?.aiArgv || !profileAvailable(profile)) {
    throw new ProviderOperationError('provider_not_connected', 404)
  }

  const argv = profile.aiArgv(resolveCommand(profile), {
    prompt: args.input.prompt,
    system: args.input.system,
    ...(args.input.modelId?.trim() ? { model: args.input.modelId.trim() } : {}),
  })
  const cwd = await mkdtemp(join(tmpdir(), 'acorn-generate-'))
  const backendId = `${HARNESS_BACKEND_PREFIX}${profile.id}`
  try {
    const run = await scheduler.run(backendId, backendId, HARNESS_BUDGETS, () =>
      runHeadless(argv, {
        cwd,
        env: brokerEnv({ passthrough: AGENT_TOOL_PASSTHROUGH }),
        timeoutMs,
        ...(args.input.signal ? { signal: args.input.signal } : {}),
        ...(profile.streamJson ? { adapter: profile.streamJson } : {}),
      }),
    )
    const text = run.capture.result?.trim() ?? ''
    if (run.status !== 'ok' || !text) {
      console.warn(`[model:harness] ${profile.id} ${run.status}`)
      throw new ProviderOperationError('provider_unavailable', 502)
    }
    return {
      text,
      providerId: profile.id,
      connectionId: backendId,
      modelId: reportedModel(run.capture.events) || args.input.modelId?.trim() || 'default',
      ...(run.capture.usage ? { usage: usageOf(run.capture.usage) } : {}),
    }
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

const reportedModel = (events: StreamEvent[]): string => {
  for (let index = events.length - 1; index >= 0; index--) {
    const model = events[index]?.model
    if (typeof model === 'string' && model.trim()) return model.trim()
  }
  return ''
}

const usageOf = (usage: { inputTokens?: number; outputTokens?: number }): GenerateTextResult['usage'] => ({
  ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
  ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
})
