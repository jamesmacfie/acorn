import type { AgentDriver, AgentDriverFactory } from './types'

export class AgentDriverRegistry {
  readonly #factories = new Map<string, AgentDriverFactory>()

  register(providerId: string, factory: AgentDriverFactory): () => void {
    if (this.#factories.has(providerId)) throw new Error(`Agent driver already registered: ${providerId}`)
    this.#factories.set(providerId, factory)
    return () => this.#factories.delete(providerId)
  }

  create(providerId: string): AgentDriver | null {
    return this.#factories.get(providerId)?.() ?? null
  }

  providers(): string[] {
    return [...this.#factories.keys()].sort()
  }

  clear(): void {
    this.#factories.clear()
  }
}

export const agentDriverRegistry = new AgentDriverRegistry()
