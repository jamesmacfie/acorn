// `issue_detail`: one linked issue or error, in full, for an agent that has to act on it
// (docs/agent-tools.md § issue_detail).
//
// Core owns this stable cross-provider tool. What each provider owns is the read itself, through the
// `detail` member on its contribution. That split is why one tool covers every connected issue tracker
// and error tracker, and why a third one needs no change here. A loaded plugin may also declare its own
// task-scoped tools, but doing so would create a provider-specific tool rather than this aggregation.
//
// Why it exists next to `linked_issues`: that tool answers "what is attached to this task" from the
// cached summary, which is an identifier, a title, a URL and a state. An agent asked to implement a
// ticket needs the description and the comments, and an agent asked to fix an error needs the trace.
// Neither is in a summary, and neither is in the task-context prompt.
import { z } from 'zod'
import { listProviderConnections } from '../integrations/connections.ts'
import { integrationProviderRegistry } from '../integrations/registry.ts'
import { runProviderResource } from '../integrations/resourceRuntime.ts'
import type { IntegrationProviderContribution, ProviderDetailContext } from '../integrations/types.ts'
import type { AppDatabase } from '../db/index.ts'
import type { SecretService } from '../core/secrets.ts'
import { ToolError, type AgentToolContribution } from './registry.ts'

export type IssueDetailDeps = { db: AppDatabase; secrets: SecretService }

const input = z.object({
  identifier: z.string().min(1).describe("the item's own id, such as 'ENG-42' for Linear or '142' for Rollbar"),
  provider: z.string().optional().describe("which provider to ask, such as 'linear' or 'rollbar'. Default: every connected one that can answer"),
  refresh: z.boolean().optional().describe('read from the provider instead of serving the cached copy'),
})

// Providers that can answer at all, in registration order, narrowed to one when the agent named it.
function candidates(providerId: string | undefined): IntegrationProviderContribution[] {
  if (providerId) {
    const provider = integrationProviderRegistry.get(providerId)
    if (!provider) throw new ToolError('bad_request', `No such provider '${providerId}'.`)
    if (!provider.detail) throw new ToolError('bad_request', `Provider '${providerId}' offers item summaries only.`)
    return [provider]
  }
  return integrationProviderRegistry.list().filter((provider) => provider.detail)
}

export function issueDetailTool(deps: IssueDetailDeps): AgentToolContribution {
  return {
    name: 'issue_detail',
    description:
      "One issue or error in full, from the tracker it lives in: a Linear ticket's description and comments, or a Rollbar item with its newest occurrence. Reads acorn's provider mirror and refreshes it when the cached copy has expired. Use this when linked_issues or the task context names something you have to act on.",
    input,
    scope: 'task',
    risk: 'read',
    whenDescription: 'Available when a connected provider can return item detail.',
    when: () => candidates(undefined).length > 0,
    handler: async (raw, ctx) => {
      const args = input.parse(raw)
      const providers = candidates(args.provider)
      if (!providers.length) throw new ToolError('not_found', 'No connected provider can return item detail.')

      // Which workspace owns a bare `ENG-42` is exactly what is unknown, so every connection gets
      // asked in turn and the first that answers wins. The same loop the provider's own detail route
      // runs, for the same reason.
      let refused: string | null = null
      for (const provider of providers) {
        for (const connection of await listProviderConnections(deps.db, ctx.userLogin, provider.id)) {
          if (connection.status === 'disabled' || connection.status === 'needs-auth') continue
          const context: ProviderDetailContext = {
            resource: (resourceId, resourceInput, force) =>
              runProviderResource({
                db: deps.db,
                userId: ctx.userLogin,
                secrets: deps.secrets,
                providerId: provider.id,
                connectionId: connection.id,
                resourceId,
                input: resourceInput,
                force: force ?? args.refresh,
              }),
          }
          try {
            const detail = await provider.detail!(context, args.identifier)
            if (detail) return { provider: provider.id, connectionId: connection.id, identifier: args.identifier, detail }
          } catch (error) {
            // "Not in this workspace" is the expected answer from every connection but one, so a real
            // failure from any of them is the more useful thing to report if nothing answers at all.
            refused ??= error instanceof Error ? error.message : String(error)
          }
        }
      }
      throw new ToolError(
        'not_found',
        refused ?? `No connected ${providers.map((provider) => provider.label).join(' or ')} workspace has '${args.identifier}'.`,
      )
    },
  }
}
