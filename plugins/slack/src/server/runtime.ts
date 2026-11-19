import type { SlackCallMethod } from '@acorn/protocol/account.ts'
import type { AgentSessionExecute } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import type {
  AgentRequestsCapability,
  AgentReviewInputCapability,
  AgentTurnsCapability,
} from '@acorn/plugin-agents/contract/lifecycle.ts'
import type { AgentRequestAnswer } from '@acorn/plugin-agents/contract/requestAnswer.ts'
import { GatewayCallError, type SlackGateway } from './gateway'
import type { SlackStore } from './store'
import type { Reaction } from './text'

// What the Slack plugin needs from the Node, passed in so each part names what it uses and a test can
// hand in fakes. ../node/index.ts builds the real one on first use.
export type SlackDeps = {
  store: SlackStore
  gateway: SlackGateway
  /** The account website, where the phone app opens a task. Empty with no account service. */
  site: string
  /** `agents.sessionExecute`, bound to this plugin: gated, refusing an unguarded harness, and "by slack". */
  execute: AgentSessionExecute | null
  defaultProfileId: () => string | undefined
  turns: AgentTurnsCapability | null
  reviewInput: AgentReviewInputCapability | null
  requests: AgentRequestsCapability | null
  requestAnswer: AgentRequestAnswer | null
  tasks: {
    createRoot(projectId: string, seed: { title: string; branch?: null; origin: string }, id: string): Promise<string>
    /** True only for a task that exists and isn't archived. */
    isActive(taskId: string): Promise<boolean>
    /** The folder the task's agent works in, for the key check on what leaves the Node. */
    folder(taskId: string): Promise<string | null>
  }
  /** Projects with a folder on this Node, which are the ones a task can run in. */
  projects(): Promise<{ id: string; name: string }[]>
  /** The text with this machine's key values and anything that reads as a secret taken out. */
  safeText(text: string, folder: string | null): Promise<string>
  now: () => number
  warn: (message: string) => void
}

export type SlackRuntime = SlackDeps & {
  /** A Slack call through the gateway. A refusal is logged and answers null, so one failed post never stops a turn. */
  call(teamId: string, method: SlackCallMethod, args: Record<string, unknown>): Promise<Record<string, unknown> | null>
  post(teamId: string, channel: string, threadTs: string, text: string, markdown?: boolean): Promise<string | null>
  ephemeral(teamId: string, channel: string, user: string, text: string, threadTs?: string): Promise<void>
  /** Swap the one reaction on a message. */
  react(teamId: string, channel: string, ts: string, from: Reaction | null, to: Reaction): Promise<void>
  taskUrl(taskId: string): string
  /** Run `work` after everything queued before it. Every change to the plugin's rows goes through here, so a
   *  delivery, an agents event, and a turn starting never interleave. Only the agent call itself runs outside. */
  serial(work: () => Promise<unknown>): Promise<void>
}

export function slackRuntime(deps: SlackDeps): SlackRuntime {
  const call: SlackRuntime['call'] = async (teamId, method, args) => {
    try {
      return await deps.gateway.call(teamId, method, args)
    } catch (error) {
      // Reactions already in place or gone are the swap racing itself, not a fault.
      if (error instanceof GatewayCallError && ['already_reacted', 'no_reaction'].includes(error.slackError ?? ''))
        return null
      deps.warn(`Slack ${method} failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  let tail: Promise<void> = Promise.resolve()
  return {
    ...deps,
    call,
    serial(work) {
      tail = tail.then(work).then(
        () => {},
        (error) => deps.warn(`Slack: ${error instanceof Error ? error.message : String(error)}`),
      )
      return tail
    },
    async post(teamId, channel, threadTs, text, markdown = false) {
      const answer = await call(teamId, 'chat.postMessage', {
        channel,
        thread_ts: threadTs,
        text,
        ...(markdown ? { blocks: [{ type: 'markdown', text }] } : {}),
      })
      return typeof answer?.ts === 'string' ? answer.ts : null
    },
    async ephemeral(teamId, channel, user, text, threadTs) {
      await call(teamId, 'chat.postEphemeral', { channel, user, text, ...(threadTs ? { thread_ts: threadTs } : {}) })
    },
    async react(teamId, channel, ts, from, to) {
      if (from === to) return
      if (from) await call(teamId, 'reactions.remove', { channel, timestamp: ts, name: from })
      await call(teamId, 'reactions.add', { channel, timestamp: ts, name: to })
    },
    taskUrl: (taskId) => (deps.site ? new URL(`/t/${taskId}`, deps.site).href : ''),
  }
}
