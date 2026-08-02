import { shellProfile } from './shell'
import type { AgentProfileContribution } from './types'

// The agent-profile registry (core). The claude/codex/aider profile plugins are registered by the
// composition root (app/main/agentProfiles.ts) — core owns the registry and the default-profile
// policy, not the set of profile plugins, so a fourth profile touches zero core files (docs/plugins.md).
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

// shellProfile is core (the plain-shell fallback), so it registers at the registry's own definition;
// the claude/codex/aider plugins register through the composition root (app/main/agentProfiles.ts).
agentProfileRegistry.register(shellProfile)

// The engine's fallback when a step names no profile. A core policy value (the string id), not an
// import of the claude plugin — the plugin that supplies this id registers itself at boot.
export const DEFAULT_PROFILE_ID = 'claude-code'

export type { AgentProfileContribution, HeadlessArgv, HeadlessCapture, HeadlessOpts, StreamEvent, StreamJsonAdapter } from './types'

