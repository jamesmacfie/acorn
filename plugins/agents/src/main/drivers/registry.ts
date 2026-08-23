import { AcpDriver } from './acpDriver'
import type { HarnessLaunchSpec } from './harness'
import type { AgentDriver, AgentDriverFactory } from './types'

// The harness registry. Two doors (docs/managed-agents.md § Harnesses):
//
//   register        a launch spec, run by the shared generic driver. The default for a new harness and
//                   the only door a loaded plugin's manifest can reach.
//   registerNative  a driver factory, for a vendor protocol that carries product value ACP cannot
//                   express. First-party only, and named so that writing one is a deliberate act.
export class AgentDriverRegistry {
  readonly #factories = new Map<string, AgentDriverFactory>()

  register(spec: HarnessLaunchSpec): () => void {
    return this.registerNative(spec.id, () => new AcpDriver(spec))
  }

  registerNative(providerId: string, factory: AgentDriverFactory): () => void {
    if (this.#factories.has(providerId)) throw new Error(`Agent driver already registered: ${providerId}`)
    this.#factories.set(providerId, factory)
    return () => {
      if (this.#factories.get(providerId) === factory) this.#factories.delete(providerId)
    }
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
