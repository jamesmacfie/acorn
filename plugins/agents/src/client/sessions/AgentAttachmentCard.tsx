import { createResource, createSignal, Show } from 'solid-js'
import { saveFile } from '@acorn/plugin-api/client'
import { Button, Card, Icon, Markdown, Modal, Stack, Text } from '@acorn/plugin-api/ui'
import { createAgentMedia } from './agentMediaStore'
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
// Sibling of AgentArtifactCard, which does the same for what the agent produced.

const KIND_ICON = (mediaType: string): string => {
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf' || mediaType.startsWith('text/')) return 'file-text'
  return 'file'
}

const sizeLabel = (byteSize: number): string =>
  `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB`

export default function AgentAttachmentCard(props: { attachmentId: string }) {
  const [open, setOpen] = createSignal(false)
  const media = createAgentMedia('attachment', () => props.attachmentId)
  const [loaded] = createResource(media, async (lease) => {
    const attachment = await lease.attachment().catch(() => null)
    if (!attachment) return null
    return { lease, attachment, source: await lease.preview(attachment).catch(() => null) }
  })

  // A resource retains its previous value during a replacement read. Keep that value with its lease.
  const currentMedia = () => loaded()?.lease === media() ? loaded() : undefined
  const attachment = () => currentMedia()?.attachment
  const source = () => currentMedia()?.source
  const alt = () => imageAlt(attachment()?.filename ?? '') || 'Attachment'
  const download = async (): Promise<void> => {
    const current = attachment()
    if (!current) return
    const content = await media().content()
    await saveFile({ bytes: content.bytes, mimeType: content.type, suggestedName: content.filename ?? current.filename })
  }

  return (
    <Show when={attachment()}>
      {(present) => (
        <>
          {/* `fit`, so several of these stand in a row rather than each taking a full band. A card
              rather than a button because this is two rows tall and a control's padding is zero at the
              top and bottom, which left the picture against the frame. */}
          <Card
            fit
            pad="sm"
            title={`${present().filename} · ${sizeLabel(present().byteSize)}`}
            onPress={() => { if (source()) setOpen(true); else void download() }}
          >
            <Stack gap="inline">
              <Show when={source()} fallback={<Icon name={KIND_ICON(present().mediaType)} />}>
                {(thumbnail) => <Markdown text={`![${alt()}](${thumbnail()})`} images="thumb" />}
              </Show>
              <Text emphasis="muted">{present().filename}</Text>
            </Stack>
          </Card>
          <Show when={open() && source()}>
            {(full) => (
              <Modal title={present().filename} size="wide" onDismiss={() => setOpen(false)}>
                <Modal.Body>
                  <Markdown text={`![${alt()}](${full()})`} images="inline" />
                </Modal.Body>
                <Modal.Actions>
                  <Button variant="ghost" onPress={() => setOpen(false)}>Close</Button>
                  <Button variant="solid" tone="accent" onPress={() => void download()}>Download</Button>
                </Modal.Actions>
              </Modal>
            )}
          </Show>
        </>
      )}
    </Show>
  )
}
