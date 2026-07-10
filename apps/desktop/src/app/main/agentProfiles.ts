// App-layer activation: register the built-in agent-profile plugins into the core registry. The ONE
// place that names the profile plugins — the composition root imports it at boot, so core owns the
// registry without importing any profile plugin (docs/next Phase 10). shellProfile is core and
// self-registers in core/main/agentProfiles/index.ts.
import { agentProfileRegistry } from '../../core/main/agentProfiles'
import { aiderProfile } from '../../plugins/profiles-aider/main/aider'
import { claudeCodeProfile } from '../../plugins/profiles-claude/main/claudeCode'
import { codexProfile } from '../../plugins/profiles-codex/main/codex'

export const builtInAgentProfilePlugins = [claudeCodeProfile, codexProfile, aiderProfile] as const

for (const profile of builtInAgentProfilePlugins) agentProfileRegistry.register(profile)
