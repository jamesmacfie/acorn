import { expect, it } from 'vitest'
import type { AgentConversationItem } from './conversationItems'
import type { AgentTurn } from '../../contract/wire.ts'
import { MAX_MESSAGE_ACTION_TEXT_BYTES, messageMenuTarget, turnMenuTarget } from './transcriptMenus'

// What a plugin's menu row on a message or a turn is handed. The card tests cover when the rows show
// and when they run (./AgentEventCard.test.tsx).

const scope = { nodeId: 'node-a', taskId: 'task-1', projectId: 'project-1', sessionId: 'session-1' }
const turn = (over: Partial<AgentTurn> = {}) =>
  ({ id: 'turn-1', status: 'completed', input: [], ...over }) as unknown as AgentTurn
const card = (event: AgentConversationItem['event'], lastSeq = 4): AgentConversationItem => ({
  key: `event-${lastSeq}`,
  firstSeq: 1,
  lastSeq,
  createdAt: 1,
  turnId: 'turn-1',
  event,
})

it('hands a message its identity, role, turn status and shown text, and nothing else', () => {
  expect(messageMenuTarget(scope, card({ type: 'assistant_message', text: 'Done.', messageId: 'm1' }), turn())).toEqual(
    {
      location: 'agent.message',
      ...scope,
      itemId: 'event-4',
      turnId: 'turn-1',
      role: 'assistant',
      status: 'completed',
      text: 'Done.',
      revision: 4,
    },
  )
  // The text the card shows: no attachment placeholder once its tile is drawn, no pasted-text markers.
  const sent = turn({ input: [{ type: 'attachment', attachmentId: 'a1' }] })
  const user = messageMenuTarget(
    scope,
    card({
      type: 'user_message',
      text: 'See this\n\n[Attachment: a1]\n<pasted_content id="ab12">\nPR body\n</pasted_content id="ab12">',
    }),
    sent,
  )
  expect(user).toMatchObject({ role: 'user', text: 'See this\n\nPR body' })
})

it('has no message target for any other card, or for a message with no turn behind it', () => {
  expect(messageMenuTarget(scope, card({ type: 'reasoning', text: 'hidden' }), turn())).toBeUndefined()
  expect(
    messageMenuTarget(scope, card({ type: 'plan_proposal', text: 'Plan', itemId: 'p1' } as never), turn()),
  ).toBeUndefined()
  expect(messageMenuTarget(scope, card({ type: 'assistant_message', text: 'Done.' }), undefined)).toBeUndefined()
})

it('cuts a long message to 64 KiB of whole characters and says it did', () => {
  const ascii = messageMenuTarget(scope, card({ type: 'assistant_message', text: 'a'.repeat(70_000) }), turn())!
  expect(ascii.text).toHaveLength(MAX_MESSAGE_ACTION_TEXT_BYTES)
  expect(ascii.textTruncated).toBe(true)
  // Four bytes and two UTF-16 units each: the cut lands between characters, never inside one.
  const emoji = messageMenuTarget(scope, card({ type: 'assistant_message', text: '🌰'.repeat(20_000) }), turn())!
  expect(new TextEncoder().encode(emoji.text).length).toBe(MAX_MESSAGE_ACTION_TEXT_BYTES)
  expect(emoji.text.endsWith('🌰')).toBe(true)
  // At the limit exactly, nothing is cut.
  const full = messageMenuTarget(scope, card({ type: 'assistant_message', text: '🌰'.repeat(16_384) }), turn())!
  expect(full.textTruncated).toBeUndefined()
})

it('offers a turn only once it has finished', () => {
  const closing = card({ type: 'turn_completed', stopReason: 'end_turn' }, 9)
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
    expect(turnMenuTarget(scope, closing, turn({ status }))).toEqual({
      location: 'agent.turn',
      ...scope,
      turnId: 'turn-1',
      status,
      revision: 9,
    })
  }
  for (const status of ['queued', 'dispatching', 'active'] as const) {
    expect(turnMenuTarget(scope, closing, turn({ status })), status).toBeUndefined()
  }
  expect(turnMenuTarget(scope, card({ type: 'assistant_message', text: 'Done.' }), turn())).toBeUndefined()
})
