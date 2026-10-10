import { For, Show, untrack, type JSX } from 'solid-js'
import {
  contextMenuItems, runContextMenuItem, type AgentMessageTarget, type AgentTurnTarget, type ContentSelectionTarget,
} from '@acorn/plugin-api/client'
import { Icon, IconButton, Menu } from '@acorn/plugin-api/ui'
import { SelectionActions, type SelectedContent } from '@acorn/plugin-api/ui/host'
import type { AgentTurn } from '../../contract/wire.ts'
import type { AgentConversationItem } from './conversationItems'
import { asPlainText } from './copyFormats'
import { shownMessageText } from './messageText'

// Other plugins' rows on a transcript message (`agent.message`) and on a finished turn (`agent.turn`).
// See docs/plugins/menus-and-markers.md § Context menus. A row reaches its own plugin's route with the
// target's identity and, for a message, the text the card shows. It can't send, answer, retry or edit.

type MenuContext = Parameters<Parameters<typeof Menu>[0]['children']>[0]
type TranscriptTarget = AgentMessageTarget | AgentTurnTarget

/** The transcript a card sits in: the Node it was read from, and the task, project and session. */
export type TranscriptScope = { nodeId: string; taskId: string; projectId: string; sessionId: string }

/** The most of a message's text a row is handed, in UTF-8 bytes. */
export const MAX_MESSAGE_ACTION_TEXT_BYTES = 64 * 1024

// The statuses the Node calls settled. A queued, dispatching or active turn has no target, and that
// includes one waiting on an answer.
const FINISHED = new Set<AgentTurn['status']>(['completed', 'failed', 'cancelled', 'interrupted'])

// A whole-character prefix of at most 64 KiB. `encodeInto` never writes half a character, so `read`
// is where to cut. Text of up to a third of the limit in UTF-16 units can't be over it in UTF-8.
const capped = (text: string): { text: string; textTruncated?: true } => {
  if (text.length * 3 <= MAX_MESSAGE_ACTION_TEXT_BYTES) return { text }
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(MAX_MESSAGE_ACTION_TEXT_BYTES))
  return read < text.length ? { text: text.slice(0, read), textTruncated: true } : { text }
}

/** The target for a user or assistant message card. None for any other card, or for a message whose
 *  turn the transcript doesn't hold. `revision` is the newest event behind the card. */
export const messageMenuTarget = (
  scope: TranscriptScope,
  item: AgentConversationItem,
  turn: AgentTurn | undefined,
): AgentMessageTarget | undefined => {
  const event = item.event
  if ((event.type !== 'user_message' && event.type !== 'assistant_message') || !turn) return undefined
  return {
    location: 'agent.message', ...scope, itemId: item.key, turnId: turn.id,
    role: event.type === 'user_message' ? 'user' : 'assistant', status: turn.status,
    ...capped(shownMessageText(event, turn)), revision: item.lastSeq,
  }
}

/** The target for a turn's closing line, once the turn has finished. `revision` is that line's event. */
export const turnMenuTarget = (
  scope: TranscriptScope,
  item: AgentConversationItem,
  turn: AgentTurn | undefined,
): AgentTurnTarget | undefined =>
  item.event.type === 'turn_completed' && turn && FINISHED.has(turn.status)
    ? { location: 'agent.turn', ...scope, turnId: turn.id, status: turn.status, revision: item.lastSeq }
    : undefined

// What makes a target the same message or turn the card drew when its menu opened. The text follows
// the revision, so it needn't be compared.
const IDENTITY = ['location', 'nodeId', 'taskId', 'projectId', 'sessionId', 'itemId', 'turnId', 'status', 'revision'] as const
const sameTarget = (a: TranscriptTarget, b: TranscriptTarget | undefined): boolean =>
  !!b && IDENTITY.every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])

/** The rows other plugins offer on this target now. */
export const transcriptMenuRows = (target: TranscriptTarget | undefined) =>
  target ? contextMenuItems(target.location, target) : []

/**
 * Other plugins' rows, drawn in the owner's menu. The kit draws a menu's rows only while it is open, so
 * the target is taken here, as it opens. A row runs only while the card would still build the same
 * target (`sameTarget`). A message that streamed on, a turn that changed state, or a card now drawing
 * another session refuses the row rather than acting on what is there now.
 */
export function ContributedTranscriptRows(props: {
  context: MenuContext
  target: () => TranscriptTarget | undefined
  /** Draw a separator first, to set the rows apart from the owner's own. */
  separated?: boolean
}) {
  const opened = untrack(props.target)
  const rows = () => transcriptMenuRows(opened)
  return (
    <Show when={rows().length}>
      <Show when={props.separated}><Menu.Separator /></Show>
      <For each={rows()}>
        {(row) => (
          <Menu.Item
            context={props.context}
            // No icon, no slot: an empty one indents the label past the owner's rows.
            leading={row.icon ? <Icon name={row.icon} /> : undefined}
            onSelect={() => { if (opened && sameTarget(opened, props.target())) runContextMenuItem(row, opened) }}
          >
            {row.label}
          </Menu.Item>
        )}
      </For>
    </Show>
  )
}

/** A finished turn's menu, beside its closing line. It has no rows of its own, so it is drawn only when
 *  another plugin offers one. */
export function TurnActionsMenu(props: { target: () => AgentTurnTarget | undefined }) {
  return (
    <Show when={transcriptMenuRows(props.target()).length}>
      <Menu ariaLabel="Actions for this turn" placement="bottom-end"
        trigger={({ toggle, open }) => (
          <IconButton icon="ellipsis" label="Actions for this turn" opens="menu" expanded={open()} onPress={toggle} />
        )}
      >
        {(menu) => <ContributedTranscriptRows context={menu} target={props.target} />}
      </Menu>
    </Show>
  )
}

/** The target for text selected in a message card. It takes the message's own identity and revision,
 *  so a message that streams on after the menu opened refuses the row. */
export const messageSelectionTarget = (
  message: AgentMessageTarget | undefined,
  selected: SelectedContent | undefined,
): ContentSelectionTarget | undefined =>
  message && selected && {
    location: 'content.selection', nodeId: message.nodeId, taskId: message.taskId, projectId: message.projectId,
    ownerId: 'agents', contentKind: selected.contentKind,
    ...(selected.languageId === undefined ? {} : { languageId: selected.languageId }),
    readOnly: true, text: selected.text, revision: message.revision,
    resource: { kind: 'message', sessionId: message.sessionId, itemId: message.itemId },
  }

/** Does the card still show the message this selection came from, at the same revision? */
export const messageSelectionIsCurrent = (selection: ContentSelectionTarget, message: AgentMessageTarget | undefined): boolean =>
  !!message && selection.resource?.kind === 'message' && selection.nodeId === message.nodeId && selection.taskId === message.taskId
  && selection.projectId === message.projectId && selection.resource.sessionId === message.sessionId
  && selection.resource.itemId === message.itemId && selection.revision === message.revision

/** A message's text, open to other plugins' actions on what the person selects in it. A host with no
 *  selection offers the message's whole text, as plain text the way a rendered selection is. */
export function MessageSelectionActions(props: {
  target: () => AgentMessageTarget | undefined
  /** The text the card shows, uncut, so a whole message over the limit is refused rather than cut. */
  text: () => string
  children: JSX.Element
}) {
  return (
    <SelectionActions
      select={(selected) => messageSelectionTarget(props.target(), selected)}
      isCurrent={(selection) => messageSelectionIsCurrent(selection, props.target())}
      whole={() => ({ text: asPlainText(props.text()), contentKind: 'markdown' })}
    >
      {props.children}
    </SelectionActions>
  )
}
