import type { z } from 'zod'
import { clientDeclaration } from '@acorn/protocol/plugin/declaration.ts'
import type { pluginManifestShape } from '@acorn/protocol/plugin/contract.ts'
import {
  pluginAgentToolGrants,
  pluginContextSectionGrants,
  pluginCustomAgentGrants,
  pluginExtensionGrants,
  pluginHarnessGrants,
  pluginKeyClaimGrants,
  pluginNavigationDestinationGrants,
  pluginScheduleGrants,
  pluginTaskCheckGrants,
  pluginWebviewGrants,
} from '@acorn/protocol/plugin/grants.ts'
import type { PluginAck } from './trustStore'

type BundledManifest = Pick<
  z.infer<typeof pluginManifestShape>,
  'id' | 'version' | 'apiVersion' | 'permissions' | 'contributions' | 'emits'
>

/** What a build holds about a first-party bundle, so a host can trust it with no prompt. The time of
 * the decision is the host's to add. */
export type BundledAck = Omit<PluginAck, 'decidedAt'>

/**
 * The acceptance a build records for a client bundle it produced itself. The disclosure comes from the
 * manifest the build wrote beside the bundle, never from a Node, so a Node can't widen it by claiming
 * the same hash. The desktop records it for the bundles in its resource directory, and the phone's
 * build carries it for the same release's bundles.
 */
export function bundledAck(manifest: BundledManifest, hash: string, origin: string): BundledAck {
  const { contributions } = manifest
  return {
    pluginId: manifest.id,
    hash,
    nodeId: origin,
    version: manifest.version,
    declaration: clientDeclaration(manifest),
    permissions: manifest.permissions,
    webviews: pluginWebviewGrants(contributions),
    keyClaims: pluginKeyClaimGrants(contributions),
    navigationDestinations: pluginNavigationDestinationGrants(contributions),
    extensions: pluginExtensionGrants(manifest.id, contributions),
    schedules: pluginScheduleGrants(contributions),
    taskChecks: pluginTaskCheckGrants(contributions),
    harnesses: pluginHarnessGrants(contributions),
    agentTools: pluginAgentToolGrants(contributions),
    contextSections: pluginContextSectionGrants(contributions),
    customAgents: pluginCustomAgentGrants(contributions),
    decision: 'accepted',
  }
}
