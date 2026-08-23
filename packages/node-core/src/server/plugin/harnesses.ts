// Delivering a manifest-declared managed agent harness to the plugin that owns agent sessions.
// See docs/managed-agents.md § Harnesses for the two driver tiers and why this seam exists.
//
// Unlike schedules, collections and task checks, this is not a node-core registry with a `ctx` facet.
// The consumer is one specific plugin — plugins/agents owns every agent child process, every session
// and every byte of the transcript — so the host hands the descriptor over through the capability
// registry and that plugin does the rest. What lives here is only the contract the two sides have to
// agree on, because neither package may import the other.
//
// Resolved at delivery time and never cached: agents disabled means the same silent nothing every
// unmatched contribution gets, and re-enabling redelivers.
import { capabilityId, type Disposable } from './capabilities'

/** A probe route's answer, already fetched and JSON-parsed. `null` when the route was unreachable, a
 *  non-2xx, or not JSON. Deliberately `unknown`: these are bytes a plugin wrote, so the consumer
 *  validates them at its own boundary rather than believing a type asserted here.
 *
 *  The signal is required, not optional: a probe reaches a plugin's own node route and something has to
 *  bound the wait, the same rule a schedule run and a task check follow. */
export type HarnessProbe = (signal: AbortSignal) => Promise<unknown>

export type ManifestHarnessSpawn =
  | { command: string; args: string[] }
  // Absolute, resolved by the host inside the plugin's installed package directory. The consumer never
  // touches the filesystem to find it.
  | { entry: string; args: string[]; requires?: { command: string; env: string } }

export type ManifestHarness = {
  /** `<pluginId>:<harnessId>`, minted by the host from the manifest the descriptor arrived under, for
   *  the same reason extension points are: a manifest may not claim a name in someone else's space.
   *  Persisted into session rows and workflow steps once a session exists. */
  id: string
  /** The plugin the harness came from, so the consumer can name it in a diagnostic. */
  pluginId: string
  label: string
  glyph?: string
  spawn: ManifestHarnessSpawn
  envPassthrough: string[]
  quirks: { manualCompaction: boolean; sessionPersistence: boolean }
  terminal?: { command: string; backendPreference: 'node-pty' | 'tmux'; launchArgs: string[] }
  /** Present only when the descriptor declared the matching route. Absent means the surface shows less,
   *  which is the right answer for most agent CLIs. */
  probeUsage?: HarnessProbe
  probeAuth?: HarnessProbe
}

export type HarnessRegistry = {
  register(harness: ManifestHarness): Disposable
}

/** What a plugin hands `ctx.harnesses`: everything but the two fields only the host may set. `id` is the
 *  harness's own local id, and the host mints the qualified one from the plugin it is registering for,
 *  which is what stops a manifest claiming a name in someone else's space. */
export type PluginHarnessRegistration = Omit<ManifestHarness, 'id' | 'pluginId'> & { id: string }

/** Where this plugin's managed agent harnesses go (docs/managed-agents.md § Harnesses). A loaded plugin
 *  declares them in its manifest and the host synthesises the registration through this seam, exactly as
 *  it does for schedules and task checks. Registering when the agents plugin is absent is the same
 *  silent nothing every unmatched contribution gets. */
export type PluginHarnessRegistry = {
  register(harness: PluginHarnessRegistration): void
}

export const AGENTS_HARNESS_REGISTRY = capabilityId<HarnessRegistry>('agents.harnessRegistry')

/** `<pluginId>:<harnessId>`. Built-in ids (`claude`, `codex`) are grandfathered as bare names; every
 *  contributed one is namespaced, and the host is the only thing that mints it. */
export const qualifiedHarnessId = (pluginId: string, harnessId: string): string => `${pluginId}:${harnessId}`
