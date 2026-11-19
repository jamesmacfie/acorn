import { randomUUID } from 'node:crypto'
import type { SlackDelivery } from '@acorn/protocol/account.ts'
import type { SlackRuntime } from './runtime'
import type { Mode, Thread } from './store'
import { firstLine, installId, REACTIONS, stableId, withoutMention } from './text'
import type { Turns } from './turns'

// What arrives from Slack, by the conversation rules (docs/integrations/slack/conversation-rules.md § When the bot acts):
// events, `/acorn`, and clicks. The gateway already routed each one here; the Node checks the sender
// against its own record of the owner whatever the gateway checked.

type Payload = Record<string, unknown>
const PICK_TTL_MS = 15 * 60 * 1000
// What a static select holds. A Node with more projects offers the first ones and `/acorn project <name>`.
const MAX_PICK_OPTIONS = 100
const ACTED_SUBTYPES = new Set(['', 'thread_broadcast', 'file_share'])

const PICK_ACTION = 'acorn_project_pick'
const REMEMBER_ACTION = 'acorn_project_remember'

export function slackInbound(rt: SlackRuntime, turns: Turns, onClick?: (payload: Payload) => Promise<boolean>) {
  const { store } = rt
  const names = new Map<string, string>()

  // A guest's name, read once per user from Slack.
  async function nameOf(teamId: string, userId: string): Promise<string> {
    const key = `${teamId}:${userId}`
    if (!names.has(key)) {
      const info = await rt.call(teamId, 'users.info', { user: userId })
      const user = info?.user as { profile?: { display_name?: string }; real_name?: string; name?: string } | undefined
      names.set(key, user?.profile?.display_name || user?.real_name || user?.name || userId)
    }
    return names.get(key)!
  }

  async function event(envelope: Payload): Promise<void> {
    const teamId = installId(envelope)
    const event = (envelope.event ?? {}) as Payload
    const link = await store.link(teamId)
    if (!link) return
    if (event.type !== 'message' && event.type !== 'app_mention') return
    if (event.bot_id || typeof event.user !== 'string' || !ACTED_SUBTYPES.has(String(event.subtype ?? ''))) return
    const channel = String(event.channel)
    const ts = String(event.ts)
    const threadTs = String(event.thread_ts ?? event.ts)
    if (await store.seen(teamId, channel, ts)) return
    const mention = event.type === 'app_mention'
    const fromOwner = event.user === link.slackUserId
    const text = withoutMention(String(event.text ?? ''), mention)
    const at = rt.now()
    const thread = await store.activeThread(teamId, channel, threadTs)

    if (thread) {
      if (fromOwner) {
        await store.insertMessage({
          teamId,
          channelId: channel,
          ts,
          threadId: thread.id,
          userId: event.user,
          userName: link.slackUserName,
          text,
          role: 'owner',
          status: 'waiting',
          createdAt: at,
        })
        await rt.react(teamId, channel, ts, null, REACTIONS.received)
        return turns.pump(thread)
      }
      await store.insertMessage({
        teamId,
        channelId: channel,
        ts,
        threadId: thread.id,
        userId: event.user,
        userName: await nameOf(teamId, event.user),
        text,
        role: 'guest',
        status: 'waiting',
        createdAt: at,
      })
      if (mention && !(JSON.parse(thread.notedGuests) as string[]).includes(event.user)) {
        await store.noteGuest(thread, event.user)
        await rt.ephemeral(
          teamId,
          channel,
          event.user,
          `This thread is ${link.slackUserName}'s agent. Start a thread of your own to use yours.`,
          threadTs,
        )
      }
      return
    }

    // No thread yet, or it ended: only the owner's mention or top-level DM starts one.
    const dm = event.channel_type === 'im' || channel.startsWith('D')
    if (!fromOwner || !(mention || (dm && !event.thread_ts))) return
    await store.insertMessage({
      teamId,
      channelId: channel,
      ts,
      userId: event.user,
      userName: link.slackUserName,
      text,
      role: 'owner',
      status: 'picking',
      createdAt: at,
    })
    await rt.react(teamId, channel, ts, null, REACTIONS.received)
    const settings = await store.channel(teamId, channel)
    const mode: Mode = settings?.mode ?? (dm ? 'conversation' : 'tasks')
    const projects = await rt.projects()
    const project = projects.find((candidate) => candidate.id === settings?.projectId)
    if (!project) return offerPicker(teamId, channel, event.user, projects, { ts, threadTs })
    await open({ teamId, channel, ts, threadTs, text, dm, mode, projectId: project.id })
  }

  // A thread starts: a task of its own, or the channel's shared task, then the turn.
  async function open(start: {
    teamId: string
    channel: string
    ts: string
    threadTs: string
    text: string
    dm: boolean
    mode: Mode
    projectId: string
  }) {
    const { teamId, channel, ts, threadTs, mode, projectId } = start
    let taskId: string
    try {
      taskId = mode === 'tasks' ? await taskFor(start) : await channelTask(teamId, channel, projectId, start.dm)
    } catch (error) {
      await store.updateMessage({ teamId, channelId: channel, ts }, { status: 'failed' })
      await rt.react(teamId, channel, ts, REACTIONS.received, REACTIONS.failed)
      await rt.post(
        teamId,
        channel,
        threadTs,
        `Couldn't start a task: ${await rt.safeText(error instanceof Error ? error.message : String(error), null)}`,
      )
      return
    }
    const id = `${teamId}:${channel}:${ts}`
    // Mentioned partway through a thread: read it once, for the first turn.
    const history = threadTs !== ts ? await readHistory(teamId, channel, threadTs, ts) : null
    await store.insertThread({ id, teamId, channelId: channel, threadTs, taskId, mode, history, createdAt: rt.now() })
    await store.updateMessage({ teamId, channelId: channel, ts }, { threadId: id, status: 'waiting' })
    await turns.pump((await store.thread(id))!)
  }

  async function taskFor(start: { teamId: string; channel: string; ts: string; text: string; projectId: string }) {
    return rt.tasks.createRoot(
      start.projectId,
      { title: firstLine(start.text), origin: 'slack' },
      stableId(`${start.teamId}:${start.channel}:${start.ts}`),
    )
  }

  async function channelTask(teamId: string, channel: string, projectId: string, dm: boolean): Promise<string> {
    const current = await store.channelTask(teamId, channel, projectId)
    if (current && (await rt.tasks.isActive(current.taskId))) return current.taskId
    const createdAt = rt.now()
    const name = (await store.channel(teamId, channel))?.name
    const taskId = await rt.tasks.createRoot(
      projectId,
      {
        title: dm ? 'Slack DM' : name ? `#${name}` : 'Slack channel',
        branch: null,
        origin: 'slack',
      },
      stableId(`${teamId}:${channel}:${projectId}:${createdAt}`),
    )
    await store.setChannelTask({ teamId, channelId: channel, projectId, taskId, createdAt })
    return taskId
  }

  async function readHistory(
    teamId: string,
    channel: string,
    threadTs: string,
    before: string,
  ): Promise<string | null> {
    const replies = await rt.call(teamId, 'conversations.replies', { channel, ts: threadTs })
    const messages = (replies?.messages ?? []) as Payload[]
    const lines = []
    for (const message of messages) {
      if (
        message.ts === before ||
        Number(message.ts) > Number(before) ||
        message.bot_id ||
        typeof message.user !== 'string'
      )
        continue
      lines.push(`${await nameOf(teamId, message.user)}: ${String(message.text ?? '')}`)
    }
    return lines.length ? lines.join('\n') : null
  }

  async function offerPicker(
    teamId: string,
    channel: string,
    user: string,
    projects: { id: string; name: string }[],
    message?: { ts: string; threadTs: string },
  ) {
    if (!projects.length) {
      await rt.ephemeral(
        teamId,
        channel,
        user,
        'This Node has no projects with a folder. Add one in Acorn first.',
        message?.threadTs,
      )
      return
    }
    const pendingId = message ? randomUUID() : ''
    if (message)
      await store.insertPending({
        id: pendingId,
        teamId,
        channelId: channel,
        ts: message.ts,
        event: JSON.stringify(message),
        expiresAt: rt.now() + PICK_TTL_MS,
      })
    const option = (text: string, value: string) => ({ text: { type: 'plain_text', text: text.slice(0, 75) }, value })
    const remember = option('Remember for this channel', 'remember')
    await rt.call(teamId, 'chat.postEphemeral', {
      channel,
      user,
      ...(message ? { thread_ts: message.threadTs } : {}),
      text: 'Which project should this use?',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'Which project should this use?' },
          accessory: {
            type: 'static_select',
            action_id: PICK_ACTION,
            placeholder: { type: 'plain_text', text: 'Pick a project' },
            options: projects
              .slice(0, MAX_PICK_OPTIONS)
              .map((project) => option(project.name, `${pendingId}|${project.id}`)),
          },
        },
        // From `/acorn project`, the pick is the channel's default, so there's nothing to tick.
        ...(message
          ? [
              {
                type: 'actions',
                elements: [
                  { type: 'checkboxes', action_id: REMEMBER_ACTION, options: [remember], initial_options: [remember] },
                ],
              },
            ]
          : []),
      ],
    })
  }

  // A pick from the project picker: set the default when asked, replace the picker, and start the message.
  async function pick(payload: Payload, value: string) {
    const teamId = installId(payload)
    const user = String((payload.user as Payload).id)
    const channel = String((payload.container as Payload).channel_id)
    const respond = (text: string) =>
      rt.call(teamId, 'respond', { url: payload.response_url, body: { replace_original: true, text } })
    const link = await store.link(teamId)
    if (!link || user !== link.slackUserId) return
    const [pendingId = '', projectId = ''] = value.split('|')
    const project = (await rt.projects()).find((candidate) => candidate.id === projectId)
    if (!project) return void (await respond('That project is gone. Run `/acorn project` again.'))
    // The checkbox's state rides along on the select's click, under whatever block ID Slack gave it.
    type Checked = Record<string, { selected_options?: { value: string }[] }>
    const blocks = Object.values(((payload.state as Payload | undefined)?.values ?? {}) as Record<string, Checked>)
    const remember =
      !pendingId ||
      blocks.some((block) => block[REMEMBER_ACTION]?.selected_options?.some((option) => option.value === 'remember'))
    if (remember) await store.setChannel(teamId, channel, { projectId })
    if (!pendingId) return void (await respond(`This channel now uses ${project.name}.`))
    const pending = await store.pending(pendingId)
    await store.removePending(pendingId)
    if (!pending || pending.expiresAt <= rt.now()) return void (await respond('This expired. Mention @acorn again.'))
    const message = await store.message(teamId, channel, pending.ts)
    if (!message) return void (await respond('This expired. Mention @acorn again.'))
    await respond(`Started in ${project.name}`)
    const { threadTs } = JSON.parse(pending.event) as { threadTs: string }
    const settings = await store.channel(teamId, channel)
    const dm = channel.startsWith('D')
    await open({
      teamId,
      channel,
      ts: pending.ts,
      threadTs,
      text: message.text,
      dm,
      mode: settings?.mode ?? (dm ? 'conversation' : 'tasks'),
      projectId,
    })
  }

  async function command(payload: Payload): Promise<void> {
    const teamId = installId(payload)
    const channel = String(payload.channel_id)
    const user = String(payload.user_id)
    const link = await store.link(teamId)
    if (!link) return
    const say = (text: string) => rt.ephemeral(teamId, channel, user, text)
    if (user !== link.slackUserId) return say(`Only ${link.slackUserName} can use this Node from Slack.`)
    if (typeof payload.channel_name === 'string' && !channel.startsWith('D'))
      await store.setChannel(teamId, channel, { name: payload.channel_name })
    const [verb = '', ...rest] = String(payload.text ?? '')
      .trim()
      .split(/\s+/)
    const argument = rest.join(' ').trim()
    const dm = channel.startsWith('D')
    if (verb === 'project') {
      const projects = await rt.projects()
      if (!argument) return offerPicker(teamId, channel, user, projects)
      const match = matchProject(projects, argument)
      if (match.kind === 'none')
        return say(`No project here is called ${argument}. Run \`/acorn project\` to pick one.`)
      if (match.kind === 'many')
        return say(`More than one project starts with ${argument}: ${match.names.join(', ')}. Type more of the name.`)
      await store.setChannel(teamId, channel, { projectId: match.id })
      return say(`New threads here use ${match.name}.`)
    }
    if (verb === 'mode') {
      const current = (await store.channel(teamId, channel))?.mode ?? (dm ? 'conversation' : 'tasks')
      if (argument === 'tasks' || argument === 'conversation') {
        await store.setChannel(teamId, channel, { mode: argument })
        return say(`New threads here use ${argument} mode. Threads already going keep theirs.`)
      }
      return say(
        `This ${dm ? 'DM' : 'channel'} uses ${current} mode. In tasks mode, each new thread is a task of its own, with a branch. In conversation mode, each new thread is a session in one shared task, in the project folder. Change it with \`/acorn mode tasks\` or \`/acorn mode conversation\`.`,
      )
    }
    return say(
      'Mention @acorn, or DM it, to start an agent on your Node. `/acorn project <name>` sets this channel’s project. `/acorn mode tasks|conversation` sets how new threads work. Only your replies run as turns; anyone else’s are context.',
    )
  }

  async function interaction(payload: Payload): Promise<void> {
    if (payload.type !== 'block_actions') return
    const action = ((payload.actions ?? []) as Payload[])[0]
    if (action?.action_id === PICK_ACTION) {
      const selected = (action.selected_option as Payload | undefined)?.value
      if (typeof selected === 'string') await pick(payload, selected)
      return
    }
    await onClick?.(payload)
  }

  /** End a thread: give its grant up, and say so in it. */
  async function end(thread: Thread): Promise<void> {
    if (thread.ended) return
    await store.endThread(thread.id)
    await rt.post(thread.teamId, thread.channelId, thread.threadTs, 'Archived in Acorn.')
    await rt.gateway
      .releaseGrant(thread.teamId, thread.channelId, thread.threadTs)
      .catch((error) => rt.warn(`Slack grant release failed: ${String(error)}`))
  }

  return {
    async receive(delivery: SlackDelivery): Promise<void> {
      await store.removeExpiredPending(rt.now())
      if (delivery.kind === 'event') return event(delivery.payload)
      if (delivery.kind === 'command') return command(delivery.payload)
      return interaction(delivery.payload)
    },
    /** A session archived: end its thread. */
    async sessionArchived(sessionId: string) {
      const thread = await store.threadOfSession(sessionId)
      if (thread) await end(thread)
    },
    /** A task changed: when it's archived, end every thread it holds. */
    async taskChanged(taskId: string) {
      const threads = await store.threadsOfTask(taskId)
      if (threads.length && !(await rt.tasks.isActive(taskId))) for (const thread of threads) await end(thread)
    },
  }
}

/** Match a project by name, ignoring case: an exact match first, then a single prefix. */
export function matchProject(
  projects: { id: string; name: string }[],
  name: string,
): { kind: 'one'; id: string; name: string } | { kind: 'none' } | { kind: 'many'; names: string[] } {
  const wanted = name.toLowerCase()
  const exact = projects.find((project) => project.name.toLowerCase() === wanted)
  if (exact) return { kind: 'one', id: exact.id, name: exact.name }
  const prefixed = projects.filter((project) => project.name.toLowerCase().startsWith(wanted))
  if (prefixed.length === 1) return { kind: 'one', id: prefixed[0]!.id, name: prefixed[0]!.name }
  return prefixed.length ? { kind: 'many', names: prefixed.map((project) => project.name) } : { kind: 'none' }
}
