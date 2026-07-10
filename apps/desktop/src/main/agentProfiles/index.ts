import { aiderProfile } from './aider'
import { claudeCodeProfile } from './claudeCode'
import { codexProfile } from './codex'
import { shellProfile } from './shell'
import type { AgentProfileContribution } from './types'

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
export const builtInAgentProfiles = [shellProfile, claudeCodeProfile, codexProfile, aiderProfile] as const
for (const profile of builtInAgentProfiles) agentProfileRegistry.register(profile)

// The engine's fallback when a step names no profile.
export const DEFAULT_PROFILE_ID = claudeCodeProfile.id

export type { AgentProfileContribution, HeadlessArgv, HeadlessCapture, HeadlessOpts, StreamEvent, StreamJsonAdapter } from './types'

