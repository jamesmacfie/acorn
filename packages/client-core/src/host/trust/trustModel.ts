import {
  distribution,
  refreshPluginTrust,
  syncPluginDistribution,
  type PluginTrustRequest,
} from '../plugins/distribution'
import { awaitingInputApproval, awaitingNodeApproval, awaitingSkillApproval } from '../plugins/distributionModel'
import { grantPluginInputs, grantPluginSkills, saveDisabledNodePlugins } from '../../infra/node/nodePlugins'
import { nextDisabledList } from '../../features/settings/plugins/pluginToggle'
import {
  agentToolGrants,
  agentToolPermissionLines,
  contextSectionGrants,
  contextSectionPermissionLines,
  customAgentGrants,
  customAgentPermissionLines,
  extensionGrants,
  extensionPermissionLines,
  harnessGrants,
  harnessPermissionLines,
  keyClaimGrants,
  keyClaimPermissionLines,
  navigationDestinationGrants,
  navigationDestinationPermissionLines,
  nodePermissionLines,
  type PermissionLine,
  scheduleGrants,
  skillPermissionLines,
  schedulePermissionLines,
  taskCheckGrants,
  taskCheckPermissionLines,
  uiPermissionLines,
  webviewGrants,
  webviewPermissionLines,
  inputPermissionLines,
  providedSourceLines,
} from './permissions'
import { recordPluginTrust } from '../plugins/host'
import { clientDeclaration } from '@acorn/protocol/plugin/declaration.ts'
import type { NodePluginRow, PluginInputGrant } from '@acorn/protocol/api.ts'

// What the trust prompt says, and what answering it does (PluginTrustDialog.tsx draws it).
//
// A plain module rather than two memos inside the dialog, so a bare-Node suite with no Solid transform
// can pin the two things worth pinning. The tier split is a security claim
// (docs/security/plugin-storage-and-supply-chain.md § Design rules, rule 6): `Enforced` is a fence the
// client broker and isolated Node worker hold; `Declared` describes plugin-authored scheduled/check
// behavior, and the three lists may never be merged. And `decide` records a remembered answer, so only
// a deliberate choice may reach it.

export type TierKey = 'reads' | 'provides' | 'enforced' | 'declared' | 'web'

export const TIER_LABEL: Record<TierKey, string> = {
  reads: 'Reads your data',
  provides: 'Provides',
  enforced: 'Enforced',
  declared: 'Declared',
  web: 'Web pages',
}

type TrustLine = PermissionLine & {
  tier: TierKey
  // Did the version the owner last approved lack this grant? Always false on a first install, where
  // there is no previous version for anything to be new against.
  added: boolean
}

export type TrustTier = { key: TierKey; lines: TrustLine[] }

/**
 * Every declared line, decorated with the tier that owns it and, on an update, whether the version
 * the owner last approved had it.
 *
 * The diff runs over the grant key, never the sentence, so a copy edit is a copy edit rather than a
 * fleet-wide "asks for more" (./permissions.ts).
 */
export function trustTiers(request: PluginTrustRequest | undefined): TrustTier[] {
  const installed = request?.row.installed
  if (!request || !installed) return []
  const previous = request.previous?.partial ? undefined : request.previous
  // What its derived sources read is approved on the node, input by input, so its "what is new" comes
  // from the node's grant rather than from this device's last answer about a bundle.
  const inputs = request.row.inputs
  const skills = request.row.skills
  const groups: { key: TierKey; now: readonly PermissionLine[]; was: readonly PermissionLine[] | null }[] = [
    {
      key: 'reads',
      now: inputPermissionLines(inputs?.inputs ?? []),
      was: inputs?.granted ? inputPermissionLines(inputs.inputs.filter((input) => input.approved)) : null,
    },
    { key: 'provides', now: providedSourceLines(installed.contributions), was: null },
    {
      key: 'enforced',
      now: [
        ...uiPermissionLines(installed.permissions, request.row.name),
        ...(request.source?.kind === 'device' ? [] : nodePermissionLines(installed.permissions)),
        ...keyClaimPermissionLines(keyClaimGrants(installed.contributions)),
        ...navigationDestinationPermissionLines(navigationDestinationGrants(installed.contributions)),
        // Both directions of the cooperative seam plus any core-surface offer. `request.row.name` is the
        // plugin id the host read the manifest under, the same value every other namespace is minted
        // from, so a point's public name here is the one the rest of the app will address it by.
        ...extensionPermissionLines(extensionGrants(request.row.name, installed.contributions)),
        // The headline fact when a package contributes one: acorn will run this program as a managed
        // agent, and a second line when it also declares a one-shot text mode, because that is a second
        // invocation with its own arguments. `Enforced`, because the host spawns exactly the declared
        // command with the declared arguments and the plugin never gets a process of its own
        // (docs/managed-agents/harnesses.md § Harnesses).
        ...harnessPermissionLines(harnessGrants(installed.contributions)),
        ...agentToolPermissionLines(agentToolGrants(installed.contributions)),
      ],
      was: previous
        ? [
            ...uiPermissionLines(previous.permissions, request.row.name),
            ...nodePermissionLines(previous.permissions),
            ...keyClaimPermissionLines(previous.keyClaims ?? []),
            ...navigationDestinationPermissionLines(previous.navigationDestinations ?? []),
            ...extensionPermissionLines(previous.extensions ?? []),
            ...harnessPermissionLines(previous.harnesses ?? []),
            ...agentToolPermissionLines(previous.agentTools ?? []),
          ]
        : null,
    },
    {
      key: 'declared',
      // Skills are approved on the node, digest by digest, like inputs, so what is new about them comes
      // from that approval rather than from this device's last answer about a bundle.
      // Schedules sit here rather than under `Enforced` for the reason the legend gives: the host does
      // hold the cadence and the route confinement, but what runs is the plugin's own node code, and a
      // claim about that can never be stronger than the group it is in.
      now: [
        ...schedulePermissionLines(scheduleGrants(installed.contributions)),
        // Beside the schedules and for the same reason: the host holds the route confinement and the
        // deadline, but what runs on archive is the plugin's own node code.
        ...taskCheckPermissionLines(taskCheckGrants(installed.contributions)),
        ...contextSectionPermissionLines(contextSectionGrants(installed.contributions)),
        // Beside the context sections: both are words the plugin puts in front of an agent.
        ...customAgentPermissionLines(customAgentGrants(installed.contributions)),
        ...skillPermissionLines(skills?.skills ?? []),
      ],
      was:
        previous || skills?.granted
          ? [
              ...schedulePermissionLines(previous?.schedules ?? []),
              ...taskCheckPermissionLines(previous?.taskChecks ?? []),
              ...contextSectionPermissionLines(previous?.contextSections ?? []),
              ...customAgentPermissionLines(previous?.customAgents ?? []),
              ...(skills?.granted ? skillPermissionLines(skills.skills.filter((skill) => skill.approved)) : []),
            ]
          : null,
    },
    {
      key: 'web',
      now: webviewPermissionLines(webviewGrants(installed.contributions)),
      was: previous ? webviewPermissionLines(previous.webviews ?? []) : null,
    },
  ]
  return groups
    .filter(({ key }) => request.source?.kind !== 'device' || key !== 'declared')
    .map(({ key, now, was }) => {
      const before = was ? new Set(was.map((entry) => entry.key)) : null
      return {
        key,
        lines: now.map((entry) => ({ ...entry, tier: key, added: before ? !before.has(entry.key) : false })),
      }
    })
}

/**
 * Record an answer, accepted or rejected, and let the shell catch up.
 *
 * Both answers are remembered (the custody trust store keeps a rejection so a turned-away plugin does
 * not ask every boot), which is exactly why dismissal must not come through here: Escape is "not now"
 * and records nothing. See the dialog's `dismiss`.
 */
export async function recordTrustDecision(
  request: PluginTrustRequest,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  const installed = request.row.installed
  if (!installed) return
  await recordPluginTrust({
    pluginId: request.row.name,
    hash: request.hash,
    nodeId: request.nodeId,
    source: request.source ?? { kind: 'node', nodeId: request.nodeId },
    version: installed.version,
    declaration: clientDeclaration(installed),
    permissions: installed.permissions,
    webviews: webviewGrants(installed.contributions),
    keyClaims: keyClaimGrants(installed.contributions),
    navigationDestinations: navigationDestinationGrants(installed.contributions),
    // These grants are recorded as well as shown: the update prompt's "what is new" mark is a set
    // difference against what the owner last approved, so a grant that is not stored can never read as
    // newly requested. A package that starts reaching into another package, running itself every five
    // minutes, or running a different binary must not slide past the update prompt unremarked.
    extensions: extensionGrants(request.row.name, installed.contributions),
    schedules: scheduleGrants(installed.contributions),
    taskChecks: taskCheckGrants(installed.contributions),
    harnesses: harnessGrants(installed.contributions),
    agentTools: agentToolGrants(installed.contributions),
    contextSections: contextSectionGrants(installed.contributions),
    customAgents: customAgentGrants(installed.contributions),
    decision,
  })
  // The host's durable write succeeded. One snapshot read now changes the accepted selection and
  // pending queue together; its commit listener updates both contribution registries.
  await refreshPluginTrust()
}

/** The input list a grant covers, as the dialog showed it. The node refuses it if the installed version
 *  has moved on since. */
export const shownInputs = (row: NodePluginRow): PluginInputGrant['sources'] => {
  const sources: PluginInputGrant['sources'] = {}
  for (const input of row.inputs?.inputs ?? []) {
    sources[input.sourceId] = {
      ...sources[input.sourceId],
      [input.name]: { source: input.source, optional: input.optional },
    }
  }
  return sources
}

/**
 * Answer what the node holds for the owner: what a plugin reads, and the skills it supplies. Accepting
 * writes a grant for exactly what was shown, inputs and skill digests both, and the node refuses it if
 * the plugin moved on since. Rejecting turns the plugin off on that node, as rejecting a bundle turns its
 * interface off here. Not now goes through `resolvePendingTrust` and records nothing. Run it before
 * `recordTrustDecision` when a request carries both, so the re-read roster no longer asks once the
 * bundle answer lands.
 */
export async function recordNodeDecision(
  request: PluginTrustRequest,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  if (!awaitingNodeApproval(request.row)) return
  const nodeId = request.nodeId
  if (decision === 'accepted') {
    if (awaitingInputApproval(request.row)) await grantPluginInputs(request.row.name, shownInputs(request.row), nodeId)
    if (awaitingSkillApproval(request.row)) {
      const digests = Object.fromEntries((request.row.skills?.skills ?? []).map((skill) => [skill.name, skill.digest]))
      await grantPluginSkills(request.row.name, digests, nodeId)
    }
  } else
    await saveDisabledNodePlugins(
      nextDisabledList(distribution().byNode.get(nodeId)?.rows ?? [request.row], request.row.name, true),
      nodeId,
    )
  await syncPluginDistribution({ nodeIds: [nodeId] })
}
