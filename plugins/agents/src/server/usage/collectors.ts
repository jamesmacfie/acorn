import type { AgentProviderUsageReading } from '../../shared/usage'
import type { AgentPricingPreferences } from '../../shared/pricing'

// Who can answer "how much of this harness's plan is left", keyed by harness id.
//
// A registry, because plan usage is per harness and the set of harnesses is open
// (docs/managed-agents.md § Harnesses). Two feeders, indistinguishable downstream: the built-in CLI
// probes, registered by the plugin's node entry, and a contributed harness's `probes.usage` route,
// registered by the delivery seam. A harness with no collector shows no usage section, which is the
// honest answer for most agent CLIs.

export type AgentUsageCollector = (pricing: AgentPricingPreferences) => Promise<AgentProviderUsageReading>

export type AgentUsageCollectorEntry = {
  provider: string
  // Stamped onto the answer by the service, so a collector never has to know how the harness is named.
  label: string
  glyph?: string
  collect: AgentUsageCollector
}

export class AgentUsageCollectorRegistry {
  // Insertion order, not sorted, so the built-ins stay first and the Agent pane's provider list holds
  // still as harnesses come and go.
  readonly #entries = new Map<string, AgentUsageCollectorEntry>()

  register(entry: AgentUsageCollectorEntry): () => void {
    if (this.#entries.has(entry.provider)) throw new Error(`Agent usage collector already registered: ${entry.provider}`)
    this.#entries.set(entry.provider, entry)
    return () => {
      if (this.#entries.get(entry.provider) === entry) this.#entries.delete(entry.provider)
    }
  }

  entries(): AgentUsageCollectorEntry[] {
    return [...this.#entries.values()]
  }

  clear(): void {
    this.#entries.clear()
  }
}

export const agentUsageCollectors = new AgentUsageCollectorRegistry()
