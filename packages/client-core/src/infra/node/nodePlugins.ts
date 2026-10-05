import { createSignal } from 'solid-js'
import {
  corePluginInputGrantRoute,
  corePluginInstallRoute,
  corePluginReloadRoute,
  corePluginRequestRoute,
  corePluginReviewRoute,
  corePluginRoute,
  corePluginsRoute,
  corePluginUpdateRoute,
  type NodePluginState,
  type PluginInputGrant,
  type PluginInputGrantState,
  type PluginInstallResult,
  type PluginInstallSource,
  type PluginReloadResult,
  type PluginUninstallResult,
  type PluginUpdateResult,
} from '@acorn/protocol/api.ts'
import { readJson, writeJson } from './apiClient'
import { activeNodeId } from './activeNode'
import { onScopeEvicted } from '../../host/registries/shell/scopeEviction'
import { createLogger } from '../telemetry/logger'

const log = createLogger('fleet')

const [nodePlugins, setNodePlugins] = createSignal<NodePluginState | null>(null)

export { nodePlugins }

// Empty until the first read resolves. A node that has not answered must not be assumed to have
// anything disabled, or the first paint drops panes and adds them back.
export const disabledNodePlugins = (): readonly string[] =>
  (nodePlugins()?.plugins ?? []).filter((row) => row.disabled).map((row) => row.name)

// A read failure returns null and leaves the signal untouched, so the previous answer keeps applying
// rather than re-registering a plugin the owner turned off. It also lets the caller tell "the node
// answered" from "it did not", which is how `applyNodePlugins` decides whether to retry on the next
// mount.
export async function refreshNodePlugins(nodeId?: string): Promise<NodePluginState | null> {
  try {
    const state = await readJson<NodePluginState>(corePluginsRoute, nodeId ? { nodeId } : {})
    if (!nodeId || nodeId === activeNodeId()) setNodePlugins(state)
    return state
  } catch (error) {
    log.warn('could not read the node plugin list', error)
    return null
  }
}

// The owner's toggle. Errors propagate, because this is an action with a form behind it and has to
// report a failure rather than swallow it the way the read does.
export async function saveDisabledNodePlugins(disabled: readonly string[], nodeId?: string): Promise<NodePluginState> {
  const state = await writeJson<NodePluginState>(
    corePluginsRoute,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: [...disabled] }),
      ...(nodeId ? { nodeId } : {}),
    },
    (res) => `plugins ${res.status}`,
  )
  // Same rule as the read: only the active node's list may become the host's input.
  if (!nodeId || nodeId === activeNodeId()) setNodePlugins(state)
  return state
}

// Install, update and uninstall (docs/plugins/activation.md § Activation). Per-node like the toggle, because a
// plugin is installed on a machine and a fleet is a set of independently administered nodes.
//
// `writeJson` rather than `postJson`, which carries an idempotency key but not a node id. The key is
// minted here because only the call site knows a retry is the same logical install
// (docs/api-reference/transport.md § Request processing).
//
// None of them touch the `nodePlugins` signal. Nothing has changed in the running process, and the
// caller re-reads the roster to pick up the pending row.
const mutate = async <T>(url: string, method: string, body: unknown, nodeId?: string): Promise<T> =>
  await writeJson<T>(
    url,
    {
      method,
      headers: { 'Content-Type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
      ...(nodeId ? { nodeId } : {}),
    },
    (res) => `plugins ${res.status}`,
  )

export const installNodePlugin = async (
  source: PluginInstallSource,
  options: { allowDowngrade?: boolean; reviewRequestId?: string } = {},
  nodeId?: string,
): Promise<PluginInstallResult> => await mutate(corePluginInstallRoute, 'POST', { source, ...options }, nodeId)

export const updateNodePlugin = async (
  id: string,
  options: { allowDowngrade?: boolean; reviewRequestId?: string } = {},
  nodeId?: string,
): Promise<PluginUpdateResult> => await mutate(corePluginUpdateRoute(id), 'POST', options, nodeId)

export const uninstallNodePlugin = async (
  id: string,
  options: { purgeData?: boolean } = {},
  nodeId?: string,
): Promise<PluginUninstallResult> => await mutate(corePluginRoute(id), 'DELETE', options, nodeId)

// Swap a loaded plugin's node half in the running process, with no restart (docs/plugins/dev-loop.md § The dev
// loop). A 200 carrying `state: 'failed'` is the normal shape for code that would not start, and the
// previous instance is still serving, so callers read the state rather than waiting for a rejection.
export const reloadNodePlugin = async (id: string, nodeId?: string): Promise<PluginReloadResult> =>
  await mutate(corePluginReloadRoute(id), 'POST', {}, nodeId)

export const reviewNodePlugin = async (
  id: string,
  review: { reviewId: string; fingerprint: string },
  decision: 'approved' | 'denied',
  nodeId?: string,
): Promise<void> => {
  await mutate(corePluginReviewRoute(id), 'POST', { ...review, decision }, nodeId)
}

// What a loaded plugin's derived sources read (docs/data-sources/derived-sources.md § Approve inputs for
// loaded plugins). The read carries the panel count per input, which the node computes on each call.
export const readPluginInputGrant = async (id: string, nodeId?: string): Promise<PluginInputGrantState> =>
  await readJson<PluginInputGrantState>(corePluginInputGrantRoute(id), nodeId ? { nodeId } : {})

export const grantPluginInputs = async (id: string, sources: PluginInputGrant['sources'], nodeId?: string): Promise<void> => {
  await mutate(corePluginInputGrantRoute(id), 'POST', { sources }, nodeId)
}

export const revokePluginInputs = async (id: string, nodeId?: string): Promise<void> => {
  await mutate(corePluginInputGrantRoute(id), 'DELETE', {}, nodeId)
}

// The owner's answer to one agent-raised approval request (docs/plugins/agent-install.md § Approval-mediated
// install). It installs nothing: by this point the device has done the install, or decided not to,
// under its own principal. This closes the record and settles what the agent is told.
export const answerPluginRequest = async (
  requestId: string,
  decision: 'approved' | 'denied',
  message: string,
  nodeId?: string,
): Promise<void> => {
  await mutate(corePluginRequestRoute(requestId), 'POST', { decision, message }, nodeId)
}

// Test seam, and the node-switch reset. A stale list from the previous node must not decide which
// contributions the next node's shell gets.
export function clearNodePlugins(): void {
  setNodePlugins(null)
}

  // Registered here rather than in the shell's evictor file, so this signal and the thing that clears
  // it are one edit apart (registries/scopeEviction.ts has the argument).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') clearNodePlugins()
})
