import type { AgentInputPart, AgentNormalizedEvent, AgentTurn } from '../../contract/wire.ts'

// What a message card shows as its text. The card draws it, and a plugin's menu row on the message
// (./transcriptMenus.tsx) is handed the same string, so the two can't disagree about what was said.

type MessageEvent = Extract<AgentNormalizedEvent, { type: 'user_message' | 'assistant_message' }>

// The turn's text names each attachment as `[Attachment: <id>]`, which is what the harness is sent
// (`agentTurnInputText`). Once the card draws the attachments itself, the
// placeholder is the same fact twice, and the uglier of the two. Dropped only when there are cards to
// draw: a truncated replay can reach a card with no turn behind it, and a reader who loses the line
// entirely has no idea anything was attached.
export const withoutAttachmentPlaceholders = (text: string): string =>
  text
    .replace(/^\[Attachment: [^\]\n]+\]$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// The tags that mark another author's text for the model (a pull request body, a delegated agent's
// report). They are for the model alone, and the reader never sees their ids.
export const withoutPastedMarkers = (text: string): string =>
  !text.includes('<pasted_content id=')
    ? text
    : text
        .replace(/^<\/?pasted_content id="[0-9a-f]+">$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

// The turn's attachments belong to the reader's own turn. A subagent's brief sits inside that same
// turn, so left ungated it drew the parent's pictures and context manifest under a document the reader
// never wrote.
export const messageAttachments = (
  message: Extract<MessageEvent, { type: 'user_message' }>,
  turn: AgentTurn | undefined,
): Extract<AgentInputPart, { type: 'attachment' | 'image' }>[] =>
  message.subagentId || message.automatic
    ? []
    : (turn?.input.filter(
        (part): part is Extract<AgentInputPart, { type: 'attachment' | 'image' }> =>
          part.type === 'attachment' || part.type === 'image',
      ) ?? [])

export const shownMessageText = (message: MessageEvent, turn: AgentTurn | undefined): string =>
  message.type === 'assistant_message'
    ? message.text
    : withoutPastedMarkers(
        messageAttachments(message, turn).length ? withoutAttachmentPlaceholders(message.text) : message.text,
      )
