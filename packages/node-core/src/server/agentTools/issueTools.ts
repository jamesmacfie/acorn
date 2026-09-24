// `issue_comment` and `issue_image`: a write on, and a file read from, an item this task links
// (docs/agent-tools.md § issue_comment and issue_image).
//
// The same split as `issue_detail`: core owns the tools, and each provider owns the call through the
// `comment` and `image` hooks on its contribution. A tracker opts in by declaring the hook.
//
// Unlike `issue_detail`, both act only on an item linked to the task. The link names the connection,
// so there is no asking each workspace in turn. It also means an agent cannot post on, or spend the
// owner's credential reading from, a ticket nobody attached to its work.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ToolImageResult } from '@acorn/protocol/api.ts'
import { schema } from '../db/index.ts'
import { connectionHasCapability, getConnection, type StoredConnection } from '../integrations/connections.ts'
import { type ItemDetailDeps, providerDetailContext } from '../integrations/itemDetail.ts'
import { integrationProviderRegistry } from '../integrations/registry.ts'
import { isProviderOperationError, type IntegrationProviderContribution } from '../integrations/types.ts'
import { ToolError, type AgentToolContribution, type ToolContext } from './registry.ts'

// The types Claude reads, and its limit for one image.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const identifier = z.string().min(1).describe("the linked item's own id, such as 'ENG-42' for Linear")
const provider = z.string().optional().describe("which provider, such as 'linear'. Only needed when two linked items share an id")

type LinkedItem = { provider: IntegrationProviderContribution; connection: StoredConnection }

// The task's link to `id`, and the provider and connection it names, refusing in words the agent can
// act on when the link, the hook or the connection is missing.
async function linkedItem(deps: ItemDetailDeps, ctx: ToolContext, id: string, providerId: string | undefined, hook: 'comment' | 'image'): Promise<LinkedItem> {
  const links = (await deps.db
    .select()
    .from(schema.taskLinks)
    .where(and(eq(schema.taskLinks.taskId, ctx.taskId), eq(schema.taskLinks.identifier, id))))
    .filter((link) => !providerId || link.provider === providerId)
  if (!links.length) throw new ToolError('not_found', `'${id}' is not linked to this task. Ask the user to link it first.`)
  if (links.length > 1) throw new ToolError('bad_request', `More than one item linked to this task is '${id}'. Name the provider.`)
  const [link] = links
  const found = integrationProviderRegistry.get(link.provider)
  if (!found?.[hook]) throw new ToolError('bad_request', `${found?.label ?? link.provider} does not offer ${hook === 'comment' ? 'comments' : 'images'} to agents.`)
  const connection = await getConnection(deps.db, ctx.userLogin, link.integrationId)
  if (!connection || connection.status === 'disabled') throw new ToolError('failed', `The ${found.label} connection '${id}' belongs to is not connected.`)
  if (connection.status === 'needs-auth') throw new ToolError('failed', `The ${found.label} connection '${id}' belongs to needs the user to sign in again.`)
  return { provider: found, connection }
}

// A provider's typed refusal keeps its code, which tells the agent a key lacks a scope rather than
// that the tracker is down.
const refusal = (error: unknown): never => {
  throw new ToolError('failed', isProviderOperationError(error) ? error.code : error instanceof Error ? error.message : String(error))
}

export function issueCommentTool(deps: ItemDetailDeps): AgentToolContribution {
  const input = z.object({
    identifier,
    body: z.string().trim().min(1).max(20_000).describe('the comment, in Markdown'),
    provider,
  })
  return {
    name: 'issue_comment',
    description:
      "Post a comment on an issue linked to this task, such as a Linear ticket. It is posted as the person who connected the tracker, so say that it comes from an agent when that matters. Use it to report progress or to ask the ticket's author a question.",
    input,
    scope: 'task',
    risk: 'write',
    whenDescription: 'Available when a connected provider takes comments.',
    when: () => integrationProviderRegistry.list().some((candidate) => candidate.comment),
    handler: async (raw, ctx) => {
      const args = input.parse(raw)
      const item = await linkedItem(deps, ctx, args.identifier, args.provider, 'comment')
      // What the connection was granted, which can be narrower than what the provider offers.
      if (!connectionHasCapability(item.connection, 'comments')) {
        throw new ToolError('bad_request', `This ${item.provider.label} connection was not granted comment access.`)
      }
      const context = providerDetailContext(deps, ctx.userLogin, item.provider.id, item.connection.id)
      const idempotencyKey = ctx.callId && UUID.test(ctx.callId) ? ctx.callId : undefined
      const posted = await deps.secrets
        .use(item.connection.authRef, `${item.provider.id}: comment`, (secret) =>
          item.provider.comment!({ ...context, secret, idempotencyKey }, args.identifier, args.body))
        .catch(refusal)
      if (!posted) throw new ToolError('not_found', `${item.provider.label} has no '${args.identifier}'.`)
      // Refetched so the next issue_detail shows the comment instead of the copy cached before it.
      const refresh = providerDetailContext(deps, ctx.userLogin, item.provider.id, item.connection.id, true)
      void Promise.resolve().then(() => item.provider.detail?.(refresh, args.identifier)).catch(() => {})
      return { provider: item.provider.id, identifier: args.identifier, url: posted.url ?? null }
    },
  }
}

export function issueImageTool(deps: ItemDetailDeps): AgentToolContribution {
  const input = z.object({
    identifier,
    url: z.string().min(1).max(2_000).describe('an image URL exactly as issue_detail returned it'),
    provider,
  })
  return {
    name: 'issue_image',
    description:
      "View an image from an issue linked to this task, such as a screenshot in a Linear ticket's description or comments. Use it when the ticket's text relies on what an image shows.",
    input,
    scope: 'task',
    risk: 'read',
    whenDescription: 'Available when a connected provider serves item images.',
    when: () => integrationProviderRegistry.list().some((candidate) => candidate.image),
    handler: async (raw, ctx): Promise<ToolImageResult> => {
      const args = input.parse(raw)
      const item = await linkedItem(deps, ctx, args.identifier, args.provider, 'image')
      // Only a file the item itself points at, so the credential fetches nothing the ticket does not name.
      const detail = await item.provider.detail!(providerDetailContext(deps, ctx.userLogin, item.provider.id, item.connection.id), args.identifier).catch(refusal)
      if (!JSON.stringify(detail ?? null).includes(args.url)) {
        throw new ToolError('bad_request', `'${args.url}' does not appear in '${args.identifier}'.`)
      }
      const image = await deps.secrets
        .use(item.connection.authRef, `${item.provider.id}: image`, (secret) => item.provider.image!({ secret }, args.url))
        .catch(refusal)
      if (!image) throw new ToolError('bad_request', `${item.provider.label} does not serve '${args.url}'.`)
      const mimeType = image.mimeType.split(';')[0].trim().toLowerCase()
      if (!IMAGE_TYPES.includes(mimeType)) throw new ToolError('bad_request', `'${args.url}' is ${mimeType || 'untyped'}, not PNG, JPEG, GIF or WebP.`)
      if ((image.data.length * 3) / 4 > MAX_IMAGE_BYTES) throw new ToolError('bad_request', `'${args.url}' is larger than 5 MB.`)
      return { type: 'image', mimeType, data: image.data }
    },
  }
}
