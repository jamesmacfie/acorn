// App-layer activation: register the built-in agent-profile plugins into the core registry. The ONE
// place that names the profile plugins — the composition root imports it at boot, so core owns the
// registry without importing any profile plugin (docs/plugins.md). shellProfile is core and
// self-registers in core/main/agentProfiles/index.ts.
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { aiderProfile } from '@acorn/plugin-profiles-aider/main/aider.ts'
import { claudeCodeProfile } from '@acorn/plugin-profiles-claude/main/claudeCode.ts'
import { codexProfile } from '@acorn/plugin-profiles-codex/main/codex.ts'

export const builtInAgentProfilePlugins = [claudeCodeProfile, codexProfile, aiderProfile] as const

for (const profile of builtInAgentProfilePlugins) agentProfileRegistry.register(profile)
