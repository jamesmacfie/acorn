import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { decryptSecret } from '../session'
import {
  connectionProviderRegistry,
  type ConnectionProviderRegistry,
} from '../integrations/connectionRegistry'
import { connectionHasCapability, getConnection } from '../integrations/connections'
import {
  ProviderRequestScheduler,
  providerRequestScheduler,
} from '../integrations/budgetRuntime'
import { ProviderOperationError } from '../integrations/types'
import { ModelProviderRegistry, modelProviderRegistry } from './registry'
import type { GenerateTextInput, GenerateTextResult } from './types'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_SYSTEM_CHARS = 100_000
const MAX_PROMPT_CHARS = 1_000_000
const MAX_OUTPUT_TOKENS = 128_000

type RuntimeDependencies = {
  connectionProviders: ConnectionProviderRegistry
  modelProviders: ModelProviderRegistry
  scheduler: ProviderRequestScheduler
}

const defaultDependencies: RuntimeDependencies = {
  connectionProviders: connectionProviderRegistry,
  modelProviders: modelProviderRegistry,
  scheduler: providerRequestScheduler,
}

export type GenerateTextForConnectionArgs = {
  db: AppDatabase
  userId: string
  encryptionKey: string
  connectionId: string
  input: GenerateTextInput
  timeoutMs?: number
}

const badConfig = (): never => {
  throw new ProviderOperationError('provider_bad_config', 400)
}

const validateInput = (input: GenerateTextInput, timeoutMs: number): void => {
  if (!input.system.trim() || input.system.length > MAX_SYSTEM_CHARS) badConfig()
  if (!input.prompt.trim() || input.prompt.length > MAX_PROMPT_CHARS) badConfig()
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > MAX_OUTPUT_TOKENS) {
    badConfig()
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) badConfig()
  if (input.modelId !== undefined && !input.modelId.trim()) badConfig()
}

const parseConfig = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return {}
  }
}

const abortError = () => new ProviderOperationError('provider_unavailable', 502)

const raceWithAbort = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortError())
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

const markNeedsAuth = async (
  db: AppDatabase,
  connectionId: string,
  error: 'provider_needs_auth' | 'provider_secret_unreadable',
): Promise<void> => {
  const now = Date.now()
  await db
    .update(schema.integrations)
    .set({ status: 'needs-auth', lastValidatedAt: now, lastError: error, updatedAt: now })
    .where(eq(schema.integrations.id, connectionId))
}

export async function generateTextForConnection(
  args: GenerateTextForConnectionArgs,
  dependencies: RuntimeDependencies = defaultDependencies,
): Promise<GenerateTextResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  validateInput(args.input, timeoutMs)

  const connection = await getConnection(args.db, args.userId, args.connectionId)
  if (!connection) throw new ProviderOperationError('provider_not_connected', 404)
  if (connection.status === 'disabled') throw new ProviderOperationError('provider_not_connected', 404)
  if (connection.status === 'needs-auth') throw new ProviderOperationError('provider_needs_auth', 401)
  if (connection.status !== 'connected') throw new ProviderOperationError('provider_unavailable', 502)

  const provider = dependencies.connectionProviders.get(connection.provider)
  const adapter = dependencies.modelProviders.get(connection.provider)
  if (!provider || !adapter || provider.capabilities.textGeneration !== true) {
    throw new ProviderOperationError('provider_bad_config', 400)
  }
  if (!connectionHasCapability(connection, 'textGeneration', dependencies.connectionProviders)) {
    throw new ProviderOperationError('provider_bad_config', 400)
  }

  const secret = await decryptSecret(connection.authRef, args.encryptionKey)
  if (!secret) {
    await markNeedsAuth(args.db, connection.id, 'provider_secret_unreadable')
    throw new ProviderOperationError('provider_secret_unreadable', 400)
  }

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(args.input.signal?.reason)
  args.input.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (args.input.signal?.aborted) abortFromCaller()
  const timeout = setTimeout(() => controller.abort(new Error('model_provider_timeout')), timeoutMs)
  const modelId = args.input.modelId?.trim() || adapter.recommendedModelId

  try {
    const operation = dependencies.scheduler.run(
      provider.id,
      connection.id,
      provider.budgets,
      async () => {
        if (controller.signal.aborted) throw abortError()
        return adapter.generateText({
          secret,
          config: parseConfig(connection.config),
          input: { ...args.input, modelId, signal: controller.signal },
        })
      },
    )
    const generated = await raceWithAbort(operation, controller.signal)
    if (!generated.text.trim() || !generated.modelId.trim()) {
      throw new ProviderOperationError('provider_unavailable', 502)
    }
    return {
      text: generated.text,
      providerId: provider.id,
      connectionId: connection.id,
      modelId: generated.modelId,
      ...(generated.usage ? { usage: generated.usage } : {}),
    }
  } catch (error) {
    if (error instanceof ProviderOperationError) {
      if (error.code === 'provider_needs_auth') {
        await markNeedsAuth(args.db, connection.id, 'provider_needs_auth')
      }
      throw error
    }
    throw new ProviderOperationError('provider_unavailable', 502)
  } finally {
    clearTimeout(timeout)
    args.input.signal?.removeEventListener('abort', abortFromCaller)
  }
}
