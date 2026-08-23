import { shellProfile } from './shell'
import type { AgentProfileContribution } from './types'

// The agent-profile registry, in core. The claude, codex, and aider profile plugins register through
// the composition root. Core owns the registry and the default-profile policy, not the set of
// profiles, so adding a fourth touches no core file.
class AgentProfileRegistry {
  readonly #profiles = new Map<string, AgentProfileContribution>()

  register(profile: AgentProfileContribution): () => void {
    if (this.#profiles.has(profile.id)) throw new Error(`Duplicate agent profile '${profile.id}'.`)
    this.#profiles.set(profile.id, profile)
    return () => this.#profiles.delete(profile.id)
  }

  get(id: string): AgentProfileContribution | undefined {
    return this.#profiles.get(id)
  }

  require(id: string): AgentProfileContribution {
    const profile = this.get(id)
    if (!profile) throw new Error(`Unknown agent profile '${id}'.`)
    return profile
  }

  list(): AgentProfileContribution[] {
    return [...this.#profiles.values()]
  }
}

export const agentProfileRegistry = new AgentProfileRegistry()

// shellProfile is core's plain-shell fallback, so it registers here. The other profiles register
// through the agents plugin's node entry.
agentProfileRegistry.register(shellProfile)

// The engine's fallback when a step names no profile. A core policy value, a string id rather than
// an import of the claude plugin, and the plugin that supplies the id registers itself at boot.
export const DEFAULT_PROFILE_ID = 'claude-code'

export type { AgentProfileContribution, HeadlessArgv, HeadlessCapture, HeadlessOpts, StreamEvent, StreamJsonAdapter } from './types'

