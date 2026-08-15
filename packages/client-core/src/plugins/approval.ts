import { createSignal } from 'solid-js'
import type { PluginApprovalRequest, PluginInstallSource } from '@acorn/protocol/api.ts'

// The open/close signal for the plugin-approval dialog, split out of the component for the reason
// configTrust.ts gives: the repo's client suites run in bare Node with no Solid transform, so anything in
// a `.tsx` file is structurally untestable, and the opener is reached from the notification bell.
//
// It carries a task id and nothing else. The requests themselves are read from the node's device-only
// roster route when the dialog opens, never from the notification frame — a notice is a ping, and what the
// owner is being asked to approve has to come from the gated surface (docs/plugins.md § Approval-mediated
// install).

const [pluginApprovalTask, setPluginApprovalTask] = createSignal<string | null>(null)
export { pluginApprovalTask }

export function openPluginApproval(taskId: string): void {
  setPluginApprovalTask(taskId)
}

export function closePluginApproval(): void {
  setPluginApprovalTask(null)
}

/** One line naming where a package would come from. The node has its own copy of this for the settings
 * row (main/pluginInstaller.ts `describeSource`); this one runs on a source nothing has fetched yet. */
export const describePluginSource = (source: PluginInstallSource | undefined): string =>
  !source
    ? ''
    : 'github' in source
      ? `github:${source.github}${source.tag ? `@${source.tag}` : ''}`
      : 'npm' in source
        ? `npm:${source.npm}${source.version ? `@${source.version}` : ''}`
        : 'url' in source
          ? source.url
          : source.path

/** What the request is asking for, as one line the owner reads first. */
export const describePluginRequest = (request: PluginApprovalRequest): string =>
  request.action === 'install'
    ? `Install ${describePluginSource(request.source)}`
    : request.action === 'update'
      ? `Update ${request.pluginId}`
      : `Remove ${request.pluginId}${request.purgeData ? ' and delete its data' : ''}`

/**
 * What the agent is told once the owner has answered.
 *
 * Written on this side of the boundary on purpose. The agent gets a plain sentence and no detail it could
 * act on beyond the outcome — in particular, a refusal never explains how to get a different answer.
 */
export const pluginRequestOutcomeMessage = (
  request: PluginApprovalRequest,
  outcome: { decision: 'approved' | 'denied'; version?: string; reloaded?: boolean; removed?: boolean },
): string => {
  if (outcome.decision === 'denied') {
    return outcome.removed
      ? `The owner reviewed what this package declared and removed it. Do not ask again for the same package.`
      : `The owner declined this ${request.action}. Do not retry it.`
  }
  if (request.action === 'uninstall') return `${request.pluginId} was removed from this node.`
  const name = request.pluginId ?? describePluginSource(request.source)
  const version = outcome.version ? ` at ${outcome.version}` : ''
  return outcome.reloaded
    ? `${name}${version} is installed and reloaded; its node half is running now.`
    : `${name}${version} is installed. It starts when the node next restarts.`
}
