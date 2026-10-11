import { createResource, Show, type JSX } from 'solid-js'
import type { AgentNormalizedEvent } from '../../contract/wire.ts'
import { AGENT_ARTIFACT_POINT, transcriptMediaType, type TranscriptMediaProps } from '../../contract/transcriptMedia.ts'
import { saveFile } from '@acorn/plugin-api/client'
import { Card, Icon, Markdown, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import { createAgentMedia, type holdAgentMedia } from './agentMediaStore'
import { downloadName } from './downloadName'
import { imageAlt, isInlineImageType, MAX_INLINE_IMAGE_BYTES } from './inlineImage'

// One artifact the agent produced: its body, then a row that names it and downloads it.
//
// The body is the `agents:artifact` point, keyed by media type, so another plugin can draw a JSON
// file or a log better than a download row can (`AGENT_ARTIFACT_POINT`). With nobody
// drawing it, a raster image draws inline and anything else has no body. The download row stays
// outside the slot, so the title, size and download are there whoever draws the body.

type ArtifactEvent = Extract<AgentNormalizedEvent, { type: 'artifact' }>
type MediaLease = ReturnType<typeof holdAgentMedia>

const mediaSize = (byteSize?: number): string =>
  byteSize == null ? '' : `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB · `

/** A media card's name, size and download. Shared with AgentAttachmentCard, which draws it once a
 *  plugin draws the tile's body. */
export function MediaDownloadRow(props: { title: string; byteSize?: number; onDownload: () => void }) {
  return (
    <Row
      leading={<Icon name="paperclip" />}
      meta={<Text emphasis="muted">{mediaSize(props.byteSize)}Download →</Text>}
      onPress={props.onDownload}
    >
      {props.title}
    </Row>
  )
}

// Its own component so the bytes are only fetched while the owner's image is what is drawn.
function ArtifactImage(props: { artifact: ArtifactEvent; media: MediaLease }) {
  const [image] = createResource(
    () => ({ media: props.media, descriptor: props.artifact }),
    ({ media, descriptor }) =>
      descriptor.byteSize === undefined || descriptor.byteSize <= MAX_INLINE_IMAGE_BYTES
        ? media.preview(descriptor).catch(() => null)
        : Promise.resolve(null),
  )
  const alt = () => imageAlt(props.artifact.title) || 'Generated image'
  return <Show when={image()}>{(source) => <Markdown text={`![${alt()}](${source()})`} images="inline" />}</Show>
}

export default function AgentArtifactCard(props: { artifact: ArtifactEvent; taskId: string; sessionId: string }) {
  const media = createAgentMedia('artifact', () => props.artifact.artifactId)
  const mediaType = () => transcriptMediaType(props.artifact.mediaType)
  const download = async (): Promise<void> => {
    const { bytes, type, filename } = await media().content()
    await saveFile({
      bytes,
      mimeType: type,
      suggestedName: filename ?? (downloadName(props.artifact.title, 180) || 'artifact'),
    })
  }
  const body = (): JSX.Element => (
    <Stack gap="row">
      <Slot
        point={AGENT_ARTIFACT_POINT}
        key={mediaType()}
        taskId={props.taskId}
        props={(): TranscriptMediaProps => ({
          taskId: props.taskId,
          sessionId: props.sessionId,
          media: {
            kind: 'artifact',
            id: props.artifact.artifactId,
            filename: props.artifact.title,
            mediaType: mediaType(),
            ...(props.artifact.byteSize === undefined ? {} : { byteSize: props.artifact.byteSize }),
          },
        })}
      >
        <Show when={isInlineImageType(props.artifact.mediaType)}>
          <ArtifactImage artifact={props.artifact} media={media()} />
        </Show>
      </Slot>
      <MediaDownloadRow
        title={props.artifact.title}
        byteSize={props.artifact.byteSize}
        onDownload={() => void download()}
      />
    </Stack>
  )

  // An image keeps its card. Anything else stays a bare row unless a plugin draws a body above it.
  return (
    <Show when={isInlineImageType(props.artifact.mediaType)} fallback={body()}>
      <Card pad="sm">{body()}</Card>
    </Show>
  )
}
