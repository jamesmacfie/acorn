// The agent's install request, on its way to the owner's decision. Full flow, the prompt-injection
// defence, and the in-memory store's rationale: docs/agent-tools/plugin-tools.md § plugin_request,
// docs/plugins/agent-install.md § Approval-mediated install, docs/security/plugin-bundles.md § Third-party plugin bundles.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ToolError, type AgentToolContribution } from './registry.ts'
import type { PluginApprovalRequest, PluginInstallSource } from '@acorn/protocol/api.ts'

// One agent should not be able to fill the owner's approval queue. Both numbers bound nuisance, not
// damage (nothing here executes), so they are round rather than tuned.
const MAX_PENDING = 20
const EXPIRE_MS = 60 * 60 * 1000
const MAX_REASON_CHARS = 400

export type PluginRequestOutcome = { decision: 'approved' | 'denied'; message: string }

type Entry = { request: PluginApprovalRequest; key: string; outcome?: PluginRequestOutcome }

const entries = new Map<string, Entry>()

// Two calls with the same arguments are one question, not two. Written out rather than
// `JSON.stringify`d because key order in a parsed body is the caller's, and a request that dodged its
// own pending row by reordering two fields would ask the owner twice.
const sourceKey = (source: PluginInstallSource | undefined): string =>
  !source
    ? ''
    : 'github' in source
      ? `github:${source.github}@${source.tag ?? ''}`
      : 'npm' in source
        ? `npm:${source.npm}@${source.version ?? ''}`
        : 'url' in source
          ? `url:${source.url}`
          : `path:${source.path}`

const requestKey = (input: RaiseInput): string =>
  [input.action, input.dev ? 'dev' : 'normal', input.pluginId ?? '', sourceKey(input.source)].join('\u0000')

const prune = (): void => {
  const cutoff = Date.now() - EXPIRE_MS
  for (const [id, entry] of entries) if (entry.request.requestedAt < cutoff) entries.delete(id)
}

export type RaiseInput = Omit<PluginApprovalRequest, 'requestId' | 'requestedAt'>

export type RaiseResult =
  | { state: 'pending'; request: PluginApprovalRequest; raised: boolean }
  | { state: 'decided'; request: PluginApprovalRequest; outcome: PluginRequestOutcome }

/** Ask, or collect the answer to an identical earlier ask. Throws only when the queue is full. */
export function raisePluginRequest(input: RaiseInput): RaiseResult {
  prune()
  const key = requestKey(input)
  const existing = [...entries.values()].find((entry) => entry.key === key)
  if (existing?.outcome) {
    // Spent once (docs/plugins/agent-install.md § Approval-mediated install).
    entries.delete(existing.request.requestId)
    return { state: 'decided', request: existing.request, outcome: existing.outcome }
  }
  if (existing) return { state: 'pending', request: existing.request, raised: false }
  if (entries.size >= MAX_PENDING) {
    throw new Error(`There are already ${MAX_PENDING} plugin requests waiting for the owner. Ask them to answer those first.`)
  }
  const request: PluginApprovalRequest = { ...input, requestId: randomUUID(), requestedAt: Date.now() }
  entries.set(request.requestId, { request, key })
  return { state: 'pending', request, raised: true }
}

/** What the owner has not answered yet. Read by the roster route, which is device-only by mount. */
export function pendingPluginRequests(): PluginApprovalRequest[] {
  prune()
  return [...entries.values()].filter((entry) => !entry.outcome).map((entry) => entry.request)
}

/** The device's first install step must refer to the exact agent request it is answering. */
export function pendingPluginRequest(requestId: string): PluginApprovalRequest | null {
  prune()
  const entry = entries.get(requestId)
  return entry && !entry.outcome ? entry.request : null
}

/** Record the owner's answer. Returns null for an unknown or already-answered id, which the route
 * turns into a 404. A device answering the same request twice must not overwrite the first answer. */
export function decidePluginRequest(requestId: string, outcome: PluginRequestOutcome): PluginApprovalRequest | null {
  prune()
  const entry = entries.get(requestId)
  if (!entry || entry.outcome) return null
  entry.outcome = outcome
  return entry.request
}

/** Test seam: the store is a module singleton, like the tool registry beside it. */
export const _resetPluginRequests = (): void => entries.clear()

// ── The tool ──────────────────────────────────────────────────────────────────────────────────────

const installSource = z.union([
  z.strictObject({ github: z.string().min(1).max(200), tag: z.string().min(1).max(120).optional() }),
  z.strictObject({ npm: z.string().min(1).max(200), version: z.string().min(1).max(64).optional() }),
  z.strictObject({ url: z.string().min(1).max(2048) }),
  z.strictObject({ path: z.string().min(1).max(1024) }),
])

const toolInput = z.object({
  action: z.enum(['install', 'update', 'uninstall']).describe('install a new plugin, update an installed one, or remove one'),
  source: installSource.optional().describe('install only: where the package comes from'),
  pluginId: z.string().min(1).max(120).optional().describe('update/uninstall only: the installed plugin id'),
  dev: z.boolean().optional().describe('ask for development mode: bundle changes are auto-trusted on the approving device until the owner ends it'),
  purgeData: z.boolean().optional().describe('uninstall only: also delete the plugin’s database'),
  reason: z.string().max(MAX_REASON_CHARS).optional().describe('one line telling the owner why; shown verbatim in the approval prompt'),
})

type ToolArgs = z.infer<typeof toolInput>

const shapeProblem = (args: ToolArgs): string | null => {
  if (args.action === 'install' && !args.source) return 'An install request needs a source.'
  if (args.action !== 'install' && !args.pluginId) return `A ${args.action} request needs a pluginId.`
  if (args.action === 'install' && args.pluginId) return 'An install request names a source, not a pluginId.'
  if (args.action !== 'install' && args.source) return `A ${args.action} request names a pluginId, not a source.`
  return null
}

/**
 * The one tool that can put third-party code on a node, by asking (docs/agent-tools/plugin-tools.md §
 * plugin_request). Highest risk tier, so the owner's per-tier switch in Settings -> Agents turns it
 * off with everything else that executes.
 *
 * `notify` is injected rather than imported so the handler is testable without a WebSocket hub, the
 * same shape the terminal plugin's repo-config-trust notice uses.
 */
export function pluginRequestTool(notify: (taskId: string, action: PluginApprovalRequest['action']) => void = () => {}): AgentToolContribution {
  return {
    name: 'plugin_request',
    description:
      'Ask the owner of this node to install, update or remove a plugin. This does NOT install anything: it raises a request the owner answers in acorn, and they perform the install themselves. Call it again with identical arguments to collect their decision.',
    input: toolInput,
    scope: 'task',
    risk: 'execute',
    handler: async (raw, ctx) => {
      const args = raw as ToolArgs
      const problem = shapeProblem(args)
      if (problem) throw new ToolError('bad_request', problem)

      let result: RaiseResult
      try {
        result = raisePluginRequest({
          taskId: ctx.taskId,
          action: args.action,
          dev: args.dev === true,
          ...(args.source ? { source: args.source } : {}),
          ...(args.pluginId ? { pluginId: args.pluginId } : {}),
          ...(args.purgeData === undefined ? {} : { purgeData: args.purgeData }),
          ...(args.reason ? { reason: args.reason } : {}),
        })
      } catch (error) {
        throw new ToolError('failed', error instanceof Error ? error.message : 'That request could not be raised.')
      }

      if (result.state === 'decided') return { state: result.outcome.decision, message: result.outcome.message }

      // Only the first raise rings the bell (docs/plugins/agent-install.md § Approval-mediated install).
      if (result.raised) notify(ctx.taskId, result.request.action)
      throw new ToolError(
        'needs-trust',
        `The owner has to approve this ${args.action} in acorn before it can happen. Nothing has been downloaded or changed. Call plugin_request again with the same arguments to collect their decision; do not poll in a loop.`,
      )
    },
  }
}
