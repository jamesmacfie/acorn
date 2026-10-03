// Delivers a manifest-declared custom agent to the plugin that owns agent sessions, the same handover
// a harness takes (./harnesses.ts). See docs/managed-agents/custom-agents.md § Custom agents.
//
// Data only: a name, a harness, provider options, instructions and a tool ceiling. Nothing here is a
// program or a path, so the host's whole job is to mint the id and qualify the harness it names.
import { capabilityId, type Disposable } from './capabilities'

export type ManifestCustomAgent = {
  /** `<pluginId>:<agentId>`, minted by the host, and copied onto every session started from it. */
  id: string
  pluginId: string
  name: string
  glyph?: string
  description?: string
  /** The harness it runs on, as a session row's `providerId`: `claude`, `codex`, or a qualified
   *  contributed id. A bare id naming the manifest's own harness is qualified before it gets here. */
  providerId: string
  options: Record<string, string>
  instructions?: string
  maxToolRisk?: 'read' | 'write' | 'execute'
}

export type CustomAgentRegistry = {
  register(agent: ManifestCustomAgent): Disposable
}

/** What the host hands `ctx.customAgents`: everything but the two fields only the host may set. */
export type PluginCustomAgentRegistration = Omit<ManifestCustomAgent, 'id' | 'pluginId'> & { id: string }

export type PluginCustomAgentRegistry = {
  register(agent: PluginCustomAgentRegistration): void
}

export const AGENTS_CUSTOM_AGENT_REGISTRY = capabilityId<CustomAgentRegistry>('agents.customAgentRegistry')
