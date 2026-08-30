import { Chip, Icon } from '@acorn/plugin-api/ui'
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
export function AttachmentSlot(props: { attachment: AgentAttachment; taskId: string; onRemove: () => void }) {
  return (
    <Slot
      point={AGENT_ATTACHMENT_POINT}
      key={props.attachment.mediaType}
      taskId={props.taskId}
      props={() => ({ attachment: props.attachment, taskId: props.taskId })}
    >
      <Chip
        title={props.attachment.filename}
        leading={<Icon name={props.attachment.mediaType.startsWith('image/') ? 'image' : 'file'} />}
        onRemove={props.onRemove}
      >
        {props.attachment.filename} · {Math.max(1, Math.round(props.attachment.byteSize / 1024))} KiB
      </Chip>
    </Slot>
  )
}
