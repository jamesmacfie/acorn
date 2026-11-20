import type { AgentActivityEvent, AgentTurnChangedEvent } from '@acorn/plugin-agents/contract/lifecycle.ts'
import type { SlackRuntime } from './runtime'
import type { Message, Thread, Turn } from './store'
import {
  channelLabel,
  cutAnswer,
  duration,
  firstLine,
  guestContext,
  REACTIONS,
  rulesContext,
  type Reaction,
} from './text'

// Turns in Slack sessions (docs/integrations/slack.md § Turns). Owner messages wait in the messages table
// and run one at a time per thread. Everything after a turn starts, its reaction, status line, and
// answer, follows the agents plugin's events rather than the call's return, so a Slack turn, a turn
// typed in Acorn, and a turn a restart interrupted all take the same path.

// A Slack turn runs as long as the work does. The default ten minutes would cut a real task short.
const TURN_TIMEOUT_MS = 4 * 60 * 60 * 1000
const STATUS_EDIT_MS = 10_000
const SETTLED = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

export type Turns = ReturnType<typeof slackTurns>

export function slackTurns(rt: SlackRuntime) {
  const { store } = rt
  // Threads with an agent call in flight from this process.
  const running = new Set<string>()
  const lastStatusEdit = new Map<string, number>()

  async function owner(teamId: string) {
    return (await store.link(teamId))?.slackUserName ?? 'the owner'
  }

  /** Start the thread's next waiting owner message, unless a turn is already running in it. Called in
   *  `rt.serial`; the agent call runs outside it, and its turn joins the queue again through `onTurn`. */
  async function pump(thread: Thread): Promise<void> {
    if (running.has(thread.id) || thread.ended) return
    // Made under a link since unlinked or replaced, so nothing more runs in it.
    if (!(await store.linkOf(thread))) return void (await store.endThread(thread.id))
    const sessionId = await store.threadSession(thread.id)
    if (sessionId && (await store.openTurn(sessionId))) return
    const message = await store.nextOwnerMessage(thread.id)
    if (!message) return
    running.add(thread.id)
    void run(thread, sessionId, message).finally(() =>
      rt.serial(async () => {
        running.delete(thread.id)
        const fresh = await store.thread(thread.id)
        if (fresh) await pump(fresh)
      }),
    )
  }

  async function run(thread: Thread, sessionId: string | null, message: Message) {
    const fail = (reason: string) =>
      rt.serial(async () => {
        await store.updateMessage(message, { status: 'failed' })
        await rt.react(thread.teamId, thread.channelId, message.ts, REACTIONS.received, REACTIONS.failed)
        const said = await rt.safeText(reason, await rt.tasks.folder(thread.taskId))
        await rt.post(thread.teamId, thread.channelId, thread.threadTs, `${said} ${rt.taskUrl(thread.taskId)}`.trim())
      })
    // Checked as the turn starts, so a message queued before an unlink or a relink never runs after it.
    const link = await store.linkOf(thread)
    if (!link) return rt.serial(() => store.updateMessage(message, { status: 'failed' }))
    if (!rt.execute) return fail("This Node can't run agent turns right now.")
    const name = link.slackUserName
    const channel = await store.channel(thread.teamId, thread.channelId)
    const guests = await store.waitingGuests(thread.id)
    const context = [
      {
        label: 'Slack',
        source: 'slack',
        content: rulesContext({
          channel: channelLabel(thread.channelId, channel?.name),
          team: link.teamName,
          owner: name,
        }),
      },
      ...(guests.length
        ? [
            {
              label: 'Replies from others in the thread',
              source: 'slack',
              content: guestContext(
                guests.map((guest) => ({
                  name: guest.userName,
                  userId: guest.userId,
                  at: guest.createdAt,
                  text: guest.text,
                })),
              ),
            },
          ]
        : []),
      ...(!sessionId && thread.history
        ? [{ label: 'The thread so far', source: 'slack', content: thread.history }]
        : []),
    ]
    let started = false
    try {
      const result = await rt.execute({
        taskId: thread.taskId,
        profileId: rt.defaultProfileId(),
        title: firstLine(message.text),
        prompt: message.text,
        context,
        timeoutMs: TURN_TIMEOUT_MS,
        // The prompt comes from outside the Node, so no command runs until a person approves it.
        requireCommandApproval: true,
        stepId: `slack:${thread.teamId}:${thread.channelId}:${message.ts}`,
        ...(sessionId ? { managedSessionId: sessionId } : {}),
        onTurn: (turn) => {
          started = true
          void rt.serial(() =>
            begin(
              thread,
              message.ts,
              turn,
              guests.map((guest) => guest.ts),
            ),
          )
        },
      })
      if (!result && !started) await fail("This Node's default agent can't run a turn from Slack.")
    } catch (error) {
      if (!started) await fail(`The turn didn't start: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // The turn exists: record it against its message, then show it's running.
  async function begin(
    thread: Thread,
    messageTs: string,
    turn: { sessionId: string; turnId: string },
    guestTs: string[],
  ) {
    await store.addThreadSession(thread.id, turn.sessionId)
    await store.insertTurn({
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      threadId: thread.id,
      messageTs,
      reaction: REACTIONS.received,
      startedAt: rt.now(),
    })
    await store.updateMessage(
      { teamId: thread.teamId, channelId: thread.channelId, ts: messageTs },
      { status: 'sent', turnId: turn.turnId },
    )
    await store.markGuestsContext(thread.id, turn.turnId, guestTs)
    await showRunning(thread, (await store.turn(turn.turnId))!)
  }

  // A turn typed in Acorn has no message to react to and no status line: its two posts come at the end.
  async function showRunning(thread: Thread, turn: Turn) {
    if (!turn.messageTs) return
    if (turn.reaction !== REACTIONS.waiting) await setReaction(thread, turn, REACTIONS.running)
    if (!turn.statusTs) {
      const statusTs = await rt.post(thread.teamId, thread.channelId, thread.threadTs, 'Working…')
      if (statusTs) await store.updateTurn(turn.turnId, { statusTs })
    }
  }

  async function setReaction(thread: Thread, turn: Turn, to: Reaction) {
    if (!turn.messageTs) return
    await rt.react(thread.teamId, thread.channelId, turn.messageTs, turn.reaction as Reaction | null, to)
    await store.updateTurn(turn.turnId, { reaction: to })
  }

  // The turn settled: close its status line, set its last reaction, and post what it owes the thread.
  async function finish(thread: Thread, stale: Turn, status: string, stopReason: string | null) {
    const turn = await store.turn(stale.turnId)
    if (!turn || turn.posted) return
    const took = duration(rt.now() - turn.startedAt)
    if (turn.statusTs)
      await rt.call(thread.teamId, 'chat.update', {
        channel: thread.channelId,
        ts: turn.statusTs,
        text: status === 'completed' || status === 'failed' ? `Worked ${took}` : `Stopped after ${took}`,
      })
    await setReaction(
      thread,
      turn,
      status === 'completed' ? REACTIONS.completed : status === 'failed' ? REACTIONS.failed : REACTIONS.stopped,
    )
    const folder = await rt.tasks.folder(thread.taskId)
    const read = await rt.reviewInput?.read({ taskId: thread.taskId, sessionId: turn.sessionId, turnId: turn.turnId })
    const input = read?.available ? read.input : null
    if (!turn.messageTs && input) {
      const typed = input.userText.filter((part) => part.provenance.kind === 'person').map((part) => part.text)
      const extras = input.userText.length - typed.length
      const said = (await rt.safeText(typed.join('\n\n'), folder)) || '(no text)'
      await rt.post(
        thread.teamId,
        thread.channelId,
        thread.threadTs,
        `${await owner(thread.teamId)}, in Acorn: ${said}${extras ? `\n_With ${extras} attachment${extras === 1 ? '' : 's'} or context item${extras === 1 ? '' : 's'}, not posted here._` : ''}`,
      )
    }
    let answerTs: string | null = null
    if (status === 'completed') {
      const text = input?.finalText.trim()
        ? cutAnswer(await rt.safeText(input.finalText, folder), rt.taskUrl(thread.taskId))
        : ''
      answerTs = await rt.post(
        thread.teamId,
        thread.channelId,
        thread.threadTs,
        text || 'Done, with no message.',
        !!text,
      )
    } else if (status === 'failed') {
      answerTs = await rt.post(
        thread.teamId,
        thread.channelId,
        thread.threadTs,
        `The turn failed${stopReason ? `: ${await rt.safeText(stopReason, folder)}` : '.'} ${rt.taskUrl(thread.taskId)}`.trim(),
      )
    }
    await store.updateTurn(turn.turnId, { posted: true, answerTs })
    lastStatusEdit.delete(turn.turnId)
    const fresh = await store.thread(thread.id)
    if (fresh) await pump(fresh)
  }

  return {
    pump,

    /** `plugin:agents:turn-changed`. A turn typed in Acorn into a Slack session gets a row here, to mirror. */
    async turnChanged(event: AgentTurnChangedEvent) {
      const thread = await store.threadOfSession(event.sessionId)
      if (!thread || thread.ended || !(await store.linkOf(thread))) return
      let turn = await store.turn(event.turnId)
      if (!turn) {
        // Plugin notes, goal turns, and delegation reports aren't posted. Slack's own turns get their row
        // from `onTurn`.
        if (event.source !== 'interactive') return
        await store.insertTurn({
          turnId: event.turnId,
          sessionId: event.sessionId,
          threadId: thread.id,
          startedAt: rt.now(),
        })
        turn = (await store.turn(event.turnId))!
      }
      if (event.status === 'active' || event.status === 'dispatching') return showRunning(thread, turn)
      if (SETTLED.has(event.status)) {
        const state = (await rt.turns?.list({ taskId: thread.taskId, sessionId: event.sessionId }))?.find(
          (row) => row.turnId === event.turnId,
        )
        await finish(thread, turn, event.status, state?.stopReason ?? null)
      }
    },

    /** `plugin:agents:activity`: the status line names the newest tool, edited at most every ten seconds. */
    async activity(event: AgentActivityEvent) {
      if (event.kind !== 'tool') return
      const turn = await store.openTurn(event.sessionId)
      if (!turn?.statusTs) return
      const last = lastStatusEdit.get(turn.turnId) ?? 0
      if (rt.now() - last < STATUS_EDIT_MS) return
      lastStatusEdit.set(turn.turnId, rt.now())
      const thread = await store.thread(turn.threadId)
      if (!thread) return
      // A `429` here is the gateway keeping this Node to its share; the next edit tries again.
      await rt.call(thread.teamId, 'chat.update', {
        channel: thread.channelId,
        ts: turn.statusTs,
        text: `Working: ${await rt.safeText(event.tool.title, await rt.tasks.folder(thread.taskId))}, ${duration(rt.now() - turn.startedAt)}`,
      })
    },

    /** ✋ while the session waits on the owner, and back to ⏳ once it doesn't. */
    async waiting(sessionId: string, waiting: boolean) {
      const turn = await store.openTurn(sessionId)
      const thread = turn && (await store.thread(turn.threadId))
      if (!turn || !thread) return
      await setReaction(thread, turn, waiting ? REACTIONS.waiting : REACTIONS.running)
    },

    /** After a restart: post what turns that settled while the Node was down owe, and run what waits. */
    async recover() {
      for (const turn of await store.unpostedTurns()) {
        const thread = await store.thread(turn.threadId)
        if (!thread || !(await store.linkOf(thread))) continue
        const state = (await rt.turns?.list({ taskId: thread.taskId, sessionId: turn.sessionId }))?.find(
          (row) => row.turnId === turn.turnId,
        )
        if (state && SETTLED.has(state.status)) await finish(thread, turn, state.status, state.stopReason)
      }
      for (const thread of await store.activeThreads()) await pump(thread)
    },
  }
}
