import { Hono } from 'hono'
import { z } from 'zod'
import { accountPaths, listNodesResponseSchema } from '@acorn/protocol/account.ts'
import { type AppEnv, readNodeRelay, requireDevice, respondError } from '@acorn/plugin-api/node'
import { AccountNotSignedInError, type AccountService } from '@acorn/plugin-account/contract/service.ts'
import type { SlackState } from '../shared/state'
import { GatewayCallError, type SlackGateway } from './gateway'
import type { SlackStore } from './store'

// Settings → Slack's routes, under /v1/p/slack. A paired device only: linking Slack lets the hosted
// gateway send this Node prompts, which is the owner's call, never a task agent's. The gateway's list
// of links is only what to offer. A link counts once a device confirms the exact Slack user, because
// whoever holds the account, or the gateway itself, can put any Slack user in that list.

const confirmBody = z.strictObject({
  teamId: z.string().min(1),
  slackUserId: z.string().min(1),
  approvals: z.boolean(),
})
const teamBody = z.strictObject({ teamId: z.string().min(1) })
const approvalsBody = z.strictObject({ teamId: z.string().min(1), enabled: z.boolean() })

export function settingsRoutes(deps: {
  store: SlackStore
  gateway: SlackGateway
  service: AccountService
  /** The local links changed, so the plugin knows whether to act on events. */
  onLinksChanged: () => Promise<void>
}) {
  const { store, gateway, service } = deps

  const refusal = (c: Parameters<typeof respondError>[0], error: unknown) =>
    error instanceof AccountNotSignedInError
      ? respondError(c, 401, 'account_needs_sign_in', ['Sign in to your acorn account first.'])
      : error instanceof GatewayCallError
        ? respondError(c, 502, 'slack_gateway_unavailable', [error.message])
        : respondError(c, 502, 'slack_gateway_unavailable', ['The Slack gateway didn’t answer.'])

  return (
    new Hono<AppEnv>()
      .use('*', requireDevice)
      .get('/state', async (c) => {
        const remoteAccess = !!readNodeRelay(c.env.DATA_DIR).owner
        let links
        try {
          links = await gateway.links()
        } catch (error) {
          const signedIn = !(error instanceof AccountNotSignedInError)
          return c.json({
            signedIn,
            remoteAccess,
            links: [],
            ...(signedIn ? { error: error instanceof Error ? error.message : String(error) } : {}),
          } satisfies SlackState)
        }
        const here = links.filter((link) => link.nodeId === c.env.NODE_ID)
        await store.reconcileLinks(here)
        await deps.onLinksChanged()
        const local = await store.links()
        // Another Node's label, for "Slack work goes to Mac Studio".
        const labels = new Map<string, string>()
        if (links.some((link) => link.nodeId !== c.env.NODE_ID)) {
          const listed = listNodesResponseSchema.safeParse(
            await (await service.fetch(accountPaths.nodes)).json().catch(() => null),
          )
          for (const node of listed.success ? listed.data.nodes : []) labels.set(node.nodeId, node.label)
        }
        return c.json({
          signedIn: true,
          remoteAccess,
          links: links.map((link) => ({
            teamId: link.teamId,
            teamName: link.teamName,
            slackUserName: link.slackUserName,
            slackUserId: link.slackUserId,
            here: link.nodeId === c.env.NODE_ID,
            ...(link.nodeId === c.env.NODE_ID ? {} : { nodeLabel: labels.get(link.nodeId) ?? 'another Node' }),
            ...confirmed(local, link, c.env.NODE_ID),
          })),
        } satisfies SlackState)
      })
      // Start a link: the address that runs Sign in with Slack. The client opens it and polls `/state`.
      .post('/link', async (c) => {
        if (!readNodeRelay(c.env.DATA_DIR).owner)
          return respondError(c, 409, 'remote_access_off', ['Turn on Remote access in Settings → Account first.'])
        try {
          return c.json(await gateway.startLink(c.env.NODE_ID))
        } catch (error) {
          return refusal(c, error)
        }
      })
      // The device confirms the Slack user it was shown. The gateway must still report that user, for this
      // Node, or the link changed since the page drew it and the device has to look again.
      .post('/confirm', async (c) => {
        const body = confirmBody.safeParse(await c.req.json().catch(() => null))
        if (!body.success) return respondError(c, 400, 'bad_request')
        let links
        try {
          links = await gateway.links()
        } catch (error) {
          return refusal(c, error)
        }
        const link = links.find(
          (candidate) =>
            candidate.teamId === body.data.teamId &&
            candidate.slackUserId === body.data.slackUserId &&
            candidate.nodeId === c.env.NODE_ID,
        )
        if (!link)
          return respondError(c, 409, 'slack_link_changed', [
            'This Slack link changed after the page showed it. Check the Slack user again, then confirm.',
          ])
        await store.confirmLink(link, body.data.approvals)
        await deps.onLinksChanged()
        return c.json({ ok: true })
      })
      .post('/unlink', async (c) => {
        const body = teamBody.safeParse(await c.req.json().catch(() => null))
        if (!body.success) return respondError(c, 400, 'bad_request')
        try {
          await gateway.unlink(body.data.teamId)
        } catch (error) {
          if (!(error instanceof GatewayCallError && error.code === 'not_linked')) return refusal(c, error)
        }
        await store.removeLink(body.data.teamId)
        await deps.onLinksChanged()
        return c.json({ ok: true })
      })
      // What the composer of a session Slack started says, so nobody types there thinking it's private.
      .get('/sessions/:sessionId', async (c) => {
        const thread = await store.threadOfSession(c.req.param('sessionId'))
        if (!thread || thread.ended) return c.json({ sharedTo: null })
        const name = (await store.channel(thread.teamId, thread.channelId))?.name
        return c.json({
          sharedTo: thread.channelId.startsWith('D') ? 'a Slack DM' : name ? `#${name} in Slack` : 'a Slack channel',
        })
      })
      .put('/approvals', async (c) => {
        const body = approvalsBody.safeParse(await c.req.json().catch(() => null))
        if (!body.success) return respondError(c, 400, 'bad_request')
        if (!(await store.link(body.data.teamId))) return respondError(c, 404, 'not_found')
        await store.setApprovals(body.data.teamId, body.data.enabled)
        return c.json({ ok: true })
      })
  )
}

/** Whether a device confirmed this exact Slack user here, and the approvals choice it made. */
function confirmed(
  local: { teamId: string; slackUserId: string; approvals: boolean }[],
  link: { teamId: string; slackUserId: string; nodeId: string },
  nodeId: string,
): { confirmed: boolean; approvals: boolean } {
  const row =
    link.nodeId === nodeId
      ? local.find((entry) => entry.teamId === link.teamId && entry.slackUserId === link.slackUserId)
      : undefined
  return { confirmed: !!row, approvals: row?.approvals ?? false }
}
