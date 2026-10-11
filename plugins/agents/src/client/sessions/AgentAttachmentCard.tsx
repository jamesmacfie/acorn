import { createResource, createSignal, Show } from 'solid-js'
import { saveFile } from '@acorn/plugin-api/client'
import { Button, Card, Icon, Markdown, Modal, Stack, Text } from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import {
  AGENT_TRANSCRIPT_ATTACHMENT_POINT,
  transcriptMediaType,
  type TranscriptMediaProps,
} from '../../contract/transcriptMedia.ts'
import type { AgentAttachment } from '../../contract/wire.ts'
import { MediaDownloadRow } from './AgentArtifactCard'
import { createAgentMedia, type holdAgentMedia } from './agentMediaStore'
import { imageAlt } from './inlineImage'

// One attachment the reader sent, as the thing itself rather than as its id.
//
// The turn's text names an attachment as `[Attachment: <id>]` (server/sessions/runtimeContext.ts),
// which is the right thing to send a harness and the wrong thing to show a person: it is their own
// screenshot, and they are looking at a UUID.
//
// Always a tile, whatever it holds, so a turn with four attachments is one wrapping row rather than
// four full-width bands. The picture sits above its filename because that is the order a reader looks
// in: the thumbnail is what they recognise, the name is what confirms it. A picture opens full size on
// press; anything else downloads, which is all a browser can honestly do with a PDF.
//
// In a sent turn the tile is the `agents:transcript-attachment` point, keyed by media type
// (../../contract/transcriptMedia.ts). A plugin that draws one gets the tile's body, and the filename,
// size and download move outside the slot below it. The queue's editable turns draw the plain tile.
//
// Sibling of AgentArtifactCard, which does the same for what the agent produced.

type MediaLease = ReturnType<typeof holdAgentMedia>

const KIND_ICON = (mediaType: string): string => {
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf' || mediaType.startsWith('text/')) return 'file-text'
  return 'file'
}

const sizeLabel = (byteSize: number): string => `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB`

// The owner's own tile. Its picture is fetched here, so a tile a plugin draws instead fetches nothing.
function AttachmentTile(props: { lease: MediaLease; attachment: AgentAttachment; onDownload: () => void }) {
  const [open, setOpen] = createSignal(false)
  const [preview] = createResource(
    () => ({ lease: props.lease, attachment: props.attachment }),
    async ({ lease, attachment }) => ({ lease, source: await lease.preview(attachment).catch(() => null) }),
  )
  // A resource retains its previous value during a replacement read. Keep that value with its lease.
  // `undefined` while reading, `null` for no picture.
  const source = () => (preview()?.lease === props.lease ? preview()?.source : undefined)
  const alt = () => imageAlt(props.attachment.filename) || 'Attachment'

  // Drawn once the picture is settled, so an image tile never shows its icon first.
  return (
    <Show when={source() !== undefined}>
      {/* `fit`, so several of these stand in a row rather than each taking a full band. A card
          rather than a button because this is two rows tall and a control's padding is zero at the
          top and bottom, which left the picture against the frame. */}
      <Card
        fit
        pad="sm"
        title={`${props.attachment.filename} · ${sizeLabel(props.attachment.byteSize)}`}
        onPress={() => {
          if (source()) setOpen(true)
          else props.onDownload()
        }}
      >
        <Stack gap="inline">
          <Show when={source()} fallback={<Icon name={KIND_ICON(props.attachment.mediaType)} />}>
            {(thumbnail) => <Markdown text={`![${alt()}](${thumbnail()})`} images="thumb" />}
          </Show>
          <Text emphasis="muted">{props.attachment.filename}</Text>
        </Stack>
      </Card>
      <Show when={open() && source()}>
        {(full) => (
          <Modal title={props.attachment.filename} size="wide" onDismiss={() => setOpen(false)}>
            <Modal.Body>
              <Markdown text={`![${alt()}](${full()})`} images="inline" />
            </Modal.Body>
            <Modal.Actions>
              <Button variant="ghost" onPress={() => setOpen(false)}>
                Close
              </Button>
              <Button variant="solid" tone="accent" onPress={props.onDownload}>
                Download
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </Show>
  )
}

export default function AgentAttachmentCard(props: {
  attachmentId: string
  /** The sent turn's owner. Without it the tile is the plain one, as the queue draws it. */
  transcript?: { taskId: string; sessionId: string }
}) {
  const media = createAgentMedia('attachment', () => props.attachmentId)
  const [loaded] = createResource(media, async (lease) => ({
    lease,
    attachment: await lease.attachment().catch(() => null),
  }))
  // A resource retains its previous value during a replacement read. Keep that value with its lease.
  const attachment = () => (loaded()?.lease === media() ? (loaded()?.attachment ?? undefined) : undefined)
  const download = async (): Promise<void> => {
    const current = attachment()
    if (!current) return
    const content = await media().content()
    await saveFile({
      bytes: content.bytes,
      mimeType: content.type,
      suggestedName: content.filename ?? current.filename,
    })
  }
  const [replaced, setReplaced] = createSignal(false)

  return (
    <Show when={attachment()}>
      {(present) => {
        const tile = () => <AttachmentTile lease={media()} attachment={present()} onDownload={() => void download()} />
        return (
          <Show when={props.transcript} fallback={tile()}>
            {(transcript) => (
              <Stack gap="inline">
                <Slot
                  point={AGENT_TRANSCRIPT_ATTACHMENT_POINT}
                  key={transcriptMediaType(present().mediaType)}
                  taskId={transcript().taskId}
                  occupied={setReplaced}
                  props={(): TranscriptMediaProps => ({
                    taskId: transcript().taskId,
                    sessionId: transcript().sessionId,
                    media: {
                      kind: 'attachment',
                      id: present().id,
                      filename: present().filename,
                      mediaType: transcriptMediaType(present().mediaType),
                      byteSize: present().byteSize,
                    },
                  })}
                >
                  {tile()}
                </Slot>
                <Show when={replaced()}>
                  <MediaDownloadRow
                    title={present().filename}
                    byteSize={present().byteSize}
                    onDownload={() => void download()}
                  />
                </Show>
              </Stack>
            )}
          </Show>
        )
      }}
    </Show>
  )
}
