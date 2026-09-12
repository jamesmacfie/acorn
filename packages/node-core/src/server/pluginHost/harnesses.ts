// Delivers a manifest-declared managed agent harness to the plugin that owns agent sessions.
// See docs/managed-agents.md § Harnesses for the seam and the two driver tiers.
//
// This is a capability contract rather than a node-core registry, because the consumer is one
// specific plugin and neither package may import the other.
import { capabilityId, type Disposable } from './capabilities'

/** A probe route's answer, already fetched and JSON-parsed. `null` when the route was unreachable, a
 *  non-2xx, or not JSON. `unknown` because these are bytes a plugin wrote, so the consumer validates
 *  them at its own boundary. The signal is required: a probe calls a plugin route, so something has to
 *  bound the wait. */
export type HarnessProbe = (signal: AbortSignal) => Promise<unknown>

export type ManifestHarnessSpawn =
  | { command: string; args: string[] }
  // Absolute, resolved by the host inside the plugin's installed package directory.
  | { entry: string; args: string[]; requires?: { command: string; env: string } }

export type ManifestHarness = {
  /** `<pluginId>:<harnessId>`, minted by the host so a manifest cannot claim a name in someone else's
   *  space. Persisted into session rows and workflow steps. */
  id: string
  /** The plugin the harness came from, so the consumer can name it in a diagnostic. */
  pluginId: string
  label: string
  glyph?: string
  spawn: ManifestHarnessSpawn
  envPassthrough: string[]
  quirks: { manualCompaction: boolean; sessionPersistence: boolean }
  /** `oneShot` is the one argv a manifest may assemble: the arguments that make the CLI answer one
   *  prompt and exit, the flag its model goes behind, and how its stdout is read. Present means the
   *  consumer builds an `aiArgv` from it and the harness becomes a model backend. */
  terminal?: {
    command: string
    backendPreference: 'node-pty' | 'tmux'
    launchArgs: string[]
    oneShot?: { args: string[]; modelFlag?: string; output: 'text' | 'json-lines' }
  }
  /** Present only when the descriptor declared the matching route. Absent means the surface shows less,
   *  which suits most agent CLIs. */
  probeUsage?: HarnessProbe
  probeAuth?: HarnessProbe
}

export type HarnessRegistry = {
  register(harness: ManifestHarness): Disposable
}

/** What a plugin hands `ctx.harnesses`: everything but the two fields only the host may set. `id` is
 *  the harness's own local id, and the host mints the qualified one. */
export type PluginHarnessRegistration = Omit<ManifestHarness, 'id' | 'pluginId'> & { id: string }

/** Where this plugin's managed agent harnesses go (docs/managed-agents.md § Harnesses). Registering
 *  when the agents plugin is absent is the same silent nothing every unmatched contribution gets. */
export type PluginHarnessRegistry = {
  register(harness: PluginHarnessRegistration): void
}

export const AGENTS_HARNESS_REGISTRY = capabilityId<HarnessRegistry>('agents.harnessRegistry')

/** `<pluginId>:<harnessId>`. Built-in ids such as `claude` and `codex` stay bare names. Every
 *  contributed one is namespaced, and only the host mints it. */
export const qualifiedHarnessId = (pluginId: string, harnessId: string): string => `${pluginId}:${harnessId}`
