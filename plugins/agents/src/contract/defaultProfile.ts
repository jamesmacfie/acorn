import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// agents.defaultProfile: the agent profile a workflow step runs on when it names none. This plugin
// registers the profiles, so it says which one is the default. Absent when it isn't running.
export const AGENTS_DEFAULT_PROFILE = capabilityId<{ id: string }>('agents.defaultProfile')
