import type { SlackRuntime } from './runtime'
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
  // Cards posted by this process, by request, so an answer in Acorn can say so on the card. A card from
  // before a restart says so on its next click instead.
  const cards = new Map<string, { teamId: string; channel: string; ts: string }>()
  // Requests answered from Slack, so a second quick click doesn't overwrite the first one's line.
  const answered = new Set<string>()

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
      const link = await store.link(thread.teamId)
      if (!link) return
      if (event.status !== 'pending') {
        await turns.waiting(event.sessionId, false)
        const card = cards.get(event.requestId)
        cards.delete(event.requestId)
        if (card && !answered.has(event.requestId))
          await rt.call(card.teamId, 'chat.update', {
            channel: card.channel,
            ts: card.ts,
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
      if (!request) return
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
        cards.set(event.requestId, { teamId: thread.teamId, channel: thread.channelId, ts: posted.ts })
    },

    /** A click on a card's button. False for a click that isn't one, so the caller can try another handler. */
    async click(payload: Payload): Promise<boolean> {
      const action = ((payload.actions ?? []) as Payload[])[0]
      if (action?.action_id !== APPROVE && action?.action_id !== DENY) return false
      const teamId = String((payload.team as Payload).id)
      const user = String((payload.user as Payload).id)
      const channel = String((payload.container as Payload).channel_id)
      const [sessionId = '', requestId = ''] = String(action.value ?? '').split('|')
      const replace = (text: string) =>
        rt.call(teamId, 'respond', { url: payload.response_url, body: { replace_original: true, text } })
      const link = await store.link(teamId)
      if (!link) return true
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
      if (answered.has(requestId)) return true
      const thread = await store.threadOfSession(sessionId)
      if (!thread || !rt.requestAnswer) return true
      const request = (await rt.requests?.list({ taskId: thread.taskId, sessionId }))?.find(
        (row) => row.requestId === requestId,
      )
      if (!request || request.status !== 'pending') {
        await replace(!request || request.status === 'expired' ? 'Expired.' : 'Answered in Acorn.')
        return true
      }
      answered.add(requestId)
      const decision = action.action_id === APPROVE ? 'allow' : 'deny'
      const result = await rt.requestAnswer.answer({
        taskId: thread.taskId,
        sessionId,
        requestId,
        decision,
        idempotencyKey: String(action.action_ts ?? payload.trigger_id),
      })
      if (!result.ok) {
        answered.delete(requestId)
        await replace(
          result.reason === 'not-pending'
            ? 'Answered in Acorn.'
            : `This can't be answered from Slack. Answer it in Acorn: ${rt.taskUrl(thread.taskId)}`,
        )
        return true
      }
      cards.delete(requestId)
      await replace(`${decision === 'allow' ? 'Approved' : 'Denied'} by ${link.slackUserName}, ${time(rt.now())}`)
      return true
    },
  }
}
