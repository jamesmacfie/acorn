import { createResource, Show } from 'solid-js'
import type { AgentNormalizedEvent } from '../../contract/wire.ts'
import { saveFile } from '@acorn/plugin-api/client'
import { Card, Icon, Markdown, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { createAgentMedia, type holdAgentMedia } from './agentMediaStore'
import { downloadName } from './downloadName'
import { imageAlt, isInlineImageType, MAX_INLINE_IMAGE_BYTES } from './inlineImage'

type ArtifactEvent = Extract<AgentNormalizedEvent, { type: 'artifact' }>

const artifactSize = (byteSize?: number): string =>
  byteSize == null ? '' : `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB · `

async function downloadArtifact(artifact: ArtifactEvent, media: ReturnType<typeof holdAgentMedia>): Promise<void> {
  const { bytes, type, filename } = await media.content()
  await saveFile({
    bytes,
    mimeType: type,
    suggestedName: filename ?? (downloadName(artifact.title, 180) || 'artifact'),
  })
}

function DownloadRow(props: { artifact: ArtifactEvent; media: ReturnType<typeof holdAgentMedia> }) {
  return (
    <Row
      leading={<Icon name="paperclip" />}
      meta={<Text emphasis="muted">{artifactSize(props.artifact.byteSize)}Download →</Text>}
      onPress={() => void downloadArtifact(props.artifact, props.media)}
    >
      {props.artifact.title}
    </Row>
  )
}

export default function AgentArtifactCard(props: { artifact: ArtifactEvent }) {
  const media = createAgentMedia('artifact', () => props.artifact.artifactId)
  const [image] = createResource(
    () => ({ media: media(), descriptor: props.artifact }),
    ({ media, descriptor }) => isInlineImageType(descriptor.mediaType)
      && (descriptor.byteSize === undefined || descriptor.byteSize <= MAX_INLINE_IMAGE_BYTES)
      ? media.preview(descriptor).catch(() => null) : Promise.resolve(null),
  )
  const alt = () => imageAlt(props.artifact.title) || 'Generated image'

  return (
    <Show when={isInlineImageType(props.artifact.mediaType)} fallback={<DownloadRow artifact={props.artifact} media={media()} />}>
      <Card pad="sm">
        <Stack gap="row">
          <Show when={image()}>
            {(source) => <Markdown text={`![${alt()}](${source()})`} images="inline" />}
          </Show>
          <DownloadRow artifact={props.artifact} media={media()} />
        </Stack>
      </Card>
    </Show>
  )
}
