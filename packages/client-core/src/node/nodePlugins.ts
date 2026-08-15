import { createSignal } from 'solid-js'
import {
  corePluginInstallRoute,
  corePluginReloadRoute,
  corePluginRequestRoute,
  corePluginRoute,
  corePluginsRoute,
  corePluginUpdateRoute,
  type NodePluginState,
  type PluginInstallResult,
  type PluginInstallSource,
  type PluginReloadResult,
  type PluginUninstallResult,
  type PluginUpdateResult,
} from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import { activeNodeId } from './activeNode'
import { onScopeEvicted } from '../registries/scopeEviction'

const [nodePlugins, setNodePlugins] = createSignal<NodePluginState | null>(null)

export { nodePlugins }

// Empty until the first read resolves, which is the right default: a node that has not answered yet must
// not be assumed to have anything disabled, or the first paint would drop panes and then add them back.
export const disabledNodePlugins = (): readonly string[] =>
  (nodePlugins()?.plugins ?? []).filter((row) => row.disabled).map((row) => row.name)

// A read failure returns null and leaves the SIGNAL untouched. Two consequences, both wanted: the previous
// answer keeps applying (dropping to "nothing disabled" would re-register a plugin the owner turned off,
// which is worse than a stale list), and the caller can tell "the node answered" from "it did not" —
// `applyNodePlugins` uses that to decide whether to remember the node as applied or retry on the next mount.
export async function refreshNodePlugins(nodeId?: string): Promise<NodePluginState | null> {
  try {
    const state = await readJson<NodePluginState>(corePluginsRoute, nodeId ? { nodeId } : {})
    if (!nodeId || nodeId === activeNodeId()) setNodePlugins(state)
    return state
  } catch (error) {
    console.warn('[fleet] could not read the node plugin list:', error)
    return null
  }
}

// The owner's toggle. Errors propagate: this one is a deliberate action with a form behind it, so it must
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

// Install, update and uninstall (docs/plugins.md). All three are per-node for the
// same reason the toggle is: a plugin is installed ON a machine, and a fleet is a set of independently
// administered nodes.
//
// `writeJson` rather than `postJson`, which carries an idempotency key but not a node id. The key is
// minted here because only the call site knows a retry is the same logical install — a broker-minted one
// would defeat replay entirely (docs/api-reference.md § HTTP conventions).
//
// None of them touch the `nodePlugins` signal: nothing has changed in the RUNNING process yet, and the
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
  options: { allowDowngrade?: boolean } = {},
  nodeId?: string,
): Promise<PluginInstallResult> => await mutate(corePluginInstallRoute, 'POST', { source, ...options }, nodeId)

export const updateNodePlugin = async (
  id: string,
  options: { allowDowngrade?: boolean } = {},
  nodeId?: string,
): Promise<PluginUpdateResult> => await mutate(corePluginUpdateRoute(id), 'POST', options, nodeId)

export const uninstallNodePlugin = async (
  id: string,
  options: { purgeData?: boolean } = {},
  nodeId?: string,
): Promise<PluginUninstallResult> => await mutate(corePluginRoute(id), 'DELETE', options, nodeId)

// Swap a loaded plugin's node half in the running process, no restart (docs/plugins.md § The dev loop). A
// 200 carrying `state: 'failed'` is the normal shape for code that would not start — the previous instance
// is still serving — so callers read the state rather than treating a rejection as the only failure.
export const reloadNodePlugin = async (id: string, nodeId?: string): Promise<PluginReloadResult> =>
  await mutate(corePluginReloadRoute(id), 'POST', {}, nodeId)

// The owner's answer to one agent-raised approval request (docs/plugins.md § Approval-mediated install).
// It performs nothing: by the time this is called the device has already done the install — or decided not
// to — with its own principal, and this closes the record and settles what the agent is told.
export const answerPluginRequest = async (
  requestId: string,
  decision: 'approved' | 'denied',
  message: string,
  nodeId?: string,
): Promise<void> => {
  await mutate(corePluginRequestRoute(requestId), 'POST', { decision, message }, nodeId)
}

// Test seam, and the node-switch reset: a stale list from the previous node must not decide which
// contributions the next node's shell gets.
export function clearNodePlugins(): void {
  setNodePlugins(null)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') clearNodePlugins()
})
