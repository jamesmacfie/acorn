// App-layer activation: register the built-in agent profiles into the core registry. The composition
// root imports this at boot, so core owns the registry without importing plugins/agents.
//
// The three profiles were three separate workspace packages until they were folded into
// plugins/agents/src/main/profiles/, which states why. `shellProfile` is core's own and self-registers
// in main/agentProfiles/index.ts.
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { aiderProfile, claudeCodeProfile, codexProfile } from '@acorn/plugin-agents/main/profiles/index.ts'

export const builtInAgentProfilePlugins = [claudeCodeProfile, codexProfile, aiderProfile] as const

for (const profile of builtInAgentProfilePlugins) agentProfileRegistry.register(profile)
