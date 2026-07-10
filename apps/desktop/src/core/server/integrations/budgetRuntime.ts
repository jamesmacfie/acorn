import type { ProviderBudgets } from '../../shared/integrations'

class Semaphore {
  #active = 0
  readonly #waiting: (() => void)[] = []

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`Semaphore limit must be a positive integer, got ${limit}.`)
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#active >= this.limit) await new Promise<void>((resolve) => this.#waiting.push(resolve))
    this.#active++
    try {
      return await operation()
    } finally {
      this.#active--
      this.#waiting.shift()?.()
    }
  }
}

export class ProviderRequestScheduler {
  readonly #providers = new Map<string, Semaphore>()
  readonly #connections = new Map<string, Semaphore>()

  run<T>(providerId: string, connectionId: string, budgets: ProviderBudgets, operation: () => Promise<T>): Promise<T> {
    const provider = this.#providers.get(providerId) ?? new Semaphore(budgets.maxConcurrentRequests)
    this.#providers.set(providerId, provider)
    const connectionKey = `${providerId}:${connectionId}`
    const connection = this.#connections.get(connectionKey) ?? new Semaphore(budgets.maxConcurrentRequestsPerConnection)
    this.#connections.set(connectionKey, connection)
    // Wait for a connection slot before consuming a provider-wide slot; otherwise several queued
    // operations for one connection can starve unrelated connections while holding provider slots.
    return connection.run(() => provider.run(operation))
  }
}

export const providerRequestScheduler = new ProviderRequestScheduler()
