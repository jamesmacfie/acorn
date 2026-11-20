import type { SlackRuntime } from './runtime'
import { installId } from './text'
import type { Turns } from './turns'

// Requests in Slack sessions (docs/integrations/slack.md § Approvals). A permission request posts a card
// that shows what the agent wants to do. With the owner's **Answer approvals from Slack** on, it has
// **Approve** and **Deny**; without, it links to Acorn. Any other kind of request asks the owner to
// answer in Acorn.

type Payload = Record<string, unknown>
const APPROVE = 'acorn_approve'
const DENY = 'acorn_deny'

export function slackApprovals(rt: SlackRuntime, turns: Turns) {
  const { store } = rt

  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return {
    /** `plugin:agents:request-changed`. */
    async requestChanged(event: {
      taskId: string
      sessionId: string
      requestId: string
      kind: string
      status: string
    }) {
      const thread = await store.threadOfSession(event.sessionId)
      if (!thread || thread.ended) return
      const link = await store.linkOf(thread)
      if (!link) return
      if (event.status !== 'pending') {
        await turns.waiting(event.sessionId, false)
        // A card Slack answered already says who answered it.
        const card = await store.card(event.requestId)
        if (card && !card.answered)
          await rt.call(card.teamId, 'chat.update', {
            channel: card.channelId,
            ts: card.messageTs,
            text: event.status === 'expired' ? 'Expired.' : 'Answered in Acorn.',
            blocks: [],
          })
        return
      }
      await turns.waiting(event.sessionId, true)
      const url = rt.taskUrl(thread.taskId)
      if (event.kind !== 'permission') {
        await rt.post(
          thread.teamId,
          thread.channelId,
          thread.threadTs,
          `${link.slackUserName}, the agent has a question for you in Acorn: ${url}`,
        )
        return
      }
      const request = (await rt.requests?.list({ taskId: thread.taskId, sessionId: event.sessionId }))?.find(
        (row) => row.requestId === event.requestId,
      )
      // A request posts one card, so a repeated event can't leave a second card that answers it.
      if (!request || (await store.card(event.requestId))) return
      const folder = await rt.tasks.folder(thread.taskId)
      const title = await rt.safeText(request.title, folder)
      const detail = request.detail ? await rt.safeText(request.detail, folder) : ''
      const value = `${event.sessionId}|${event.requestId}`
      const buttons = link.approvals
        ? [
            {
              type: 'button',
              action_id: APPROVE,
              style: 'primary',
              text: { type: 'plain_text', text: 'Approve' },
              value,
            },
            { type: 'button', action_id: DENY, style: 'danger', text: { type: 'plain_text', text: 'Deny' }, value },
          ]
        : [
            {
              type: 'button',
              action_id: 'acorn_open',
              text: { type: 'plain_text', text: 'Answer in Acorn' },
              ...(url ? { url } : {}),
            },
          ]
      const posted = await rt.call(thread.teamId, 'chat.postMessage', {
        channel: thread.channelId,
        thread_ts: thread.threadTs,
        text: `The agent asks: ${title}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*The agent asks:* ${title}` } },
          ...(detail
            ? [{ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${detail.slice(0, 2_900)}\`\`\`` } }]
            : []),
          { type: 'actions', elements: buttons },
        ],
      })
      if (typeof posted?.ts === 'string')
        await store.insertCard({
          requestId: event.requestId,
          sessionId: event.sessionId,
          threadId: thread.id,
          teamId: thread.teamId,
          linkId: link.linkId,
          channelId: thread.channelId,
          messageTs: posted.ts,
          createdAt: rt.now(),
        })
    },

    /** A click on a card's button. False for a click that isn't one, so the caller can try another handler. */
    async click(payload: Payload): Promise<boolean> {
      const action = ((payload.actions ?? []) as Payload[])[0]
      if (action?.action_id !== APPROVE && action?.action_id !== DENY) return false
      const teamId = installId(payload)
      const user = String((payload.user as Payload).id)
      const container = (payload.container ?? {}) as Payload
      const channel = String(container.channel_id)
      const replace = (text: string) =>
        rt.call(teamId, 'respond', { url: payload.response_url, body: { replace_original: true, text } })
      // The click answers the request on the card it came from, by the card this Node posted at that
      // message. The button's own value must name the same request, and the card's link, thread, and
      // session must still hold. Anything else answers nothing.
      const card = await store.cardAt(teamId, channel, String(container.message_ts))
      if (!card || String(action.value ?? '') !== `${card.sessionId}|${card.requestId}`) return true
      const { sessionId, requestId } = card
      const link = await store.linkOf(card)
      const thread = await store.threadOfSession(sessionId)
      if (!link || thread?.id !== card.threadId || thread.linkId !== card.linkId || !rt.requestAnswer) return true
      if (user !== link.slackUserId) {
        await rt.ephemeral(teamId, channel, user, `Only ${link.slackUserName} can answer this.`)
        return true
      }
      if (!link.approvals) {
        await rt.ephemeral(
          teamId,
          channel,
          user,
          'Answering approvals from Slack is off. Turn it on in Settings → Slack, or answer in Acorn.',
        )
        return true
      }
      // A second quick click mustn't overwrite the first one's line.
      if (card.answered) return true
      const request = (await rt.requests?.list({ taskId: thread.taskId, sessionId }))?.find(
        (row) => row.requestId === requestId,
      )
      if (!request || request.status !== 'pending') {
        await replace(!request || request.status === 'expired' ? 'Expired.' : 'Answered in Acorn.')
        return true
      }
      if (!(await store.claimCard(requestId))) return true
      const decision = action.action_id === APPROVE ? 'allow' : 'deny'
      const result = await rt.requestAnswer.answer({
        taskId: thread.taskId,
        sessionId,
        requestId,
        decision,
        idempotencyKey: String(action.action_ts ?? payload.trigger_id),
      })
      if (!result.ok) {
        await store.releaseCard(requestId)
        await replace(
          result.reason === 'not-pending'
            ? 'Answered in Acorn.'
            : `This can't be answered from Slack. Answer it in Acorn: ${rt.taskUrl(thread.taskId)}`,
        )
        return true
      }
      await replace(`${decision === 'allow' ? 'Approved' : 'Denied'} by ${link.slackUserName}, ${time(rt.now())}`)
      return true
    },
  }
}
