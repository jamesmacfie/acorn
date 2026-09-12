// Compatibility path for the managed drivers. Core owns the allowlist because contained one-shot
// generation uses the same CLI environment without depending on this plugin.
export { AGENT_TOOL_PASSTHROUGH } from '@acorn/plugin-api/node'
