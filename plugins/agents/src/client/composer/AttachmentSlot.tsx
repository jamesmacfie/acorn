import { Show, createSignal } from 'solid-js'
import { Button, Chip, Icon } from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import { AGENT_ATTACHMENT_POINT } from '@acorn/protocol/extensionPoints.ts'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'

// One attachment on an unsent turn, and the room another plugin has to draw it instead
// (docs/plugins.md § Cooperative extension points, the `remote` kind).
//
// Keyed by media type in `replace` mode, so one attachment is always exactly one thing on screen: a
// plugin that knows more about a `.png` than a chip can say draws it, and the chip below is what a
// reader sees when nobody does. An image editor is the example the whole design started from.
//
// Its own file rather than a block inside the composer because it is the composer's only extension
// point, and a slot that cannot be rendered on its own cannot be tested on its own.
//
// Two things this owner keeps whatever a contributor draws. Removal, because the × lives inside the
// chip a contributor replaces and an attachment nobody can take off the turn is worse than a plain
// chip; it moves outside the slot for exactly as long as somebody else is drawing. And the draft array
// itself: a contributor that wants a different attachment here asks, through the point's declared
// `replace` action, and this owner decides.
export function AttachmentSlot(props: {
  attachment: AgentAttachment
  taskId: string
  sessionId: string
  onRemove: () => void
  /** Swap this attachment for another of the same task. Answers a contributor's `replace` request, and
   *  resolves once the draft holds the new id — or rejects, which the contributor shows as a failure
   *  rather than redrawing against an attachment that is not in the turn. */
  onReplace: (payload: unknown) => Promise<void>
}) {
  const [replaced, setReplaced] = createSignal(false)
  return (
    <>
      <Slot
        point={AGENT_ATTACHMENT_POINT}
        key={props.attachment.mediaType}
        taskId={props.taskId}
        occupied={setReplaced}
        // Data, in this owner's words. `sessionId` is here because a contributor redrawing across a
        // session switch has to be able to tell that it is a different draft rather than the same one
        // changed; the ids alone look identical to a tree that only ever sees props.
        props={() => ({ attachment: props.attachment, taskId: props.taskId, sessionId: props.sessionId })}
        // Host-only, and never sent to the worker. A contributor names 'replace' and the host looks it
        // up here, which is why the handler can close over exactly this attachment.
        actions={{ replace: props.onReplace }}
      >
        <Chip
          title={props.attachment.filename}
          leading={<Icon name={props.attachment.mediaType.startsWith('image/') ? 'image' : 'file'} />}
          onRemove={props.onRemove}
        >
          {props.attachment.filename} · {Math.max(1, Math.round(props.attachment.byteSize / 1024))} KiB
        </Chip>
      </Slot>
      <Show when={replaced()}>
        <Button variant="bare" size="xs" onPress={props.onRemove} label={`Remove ${props.attachment.filename}`}>✕</Button>
      </Show>
    </>
  )
}
