import { createResource, Show } from 'solid-js'
import type { AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'
import { saveFile } from '@acorn/plugin-api/client'
import { Card, Icon, Markdown, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { managedAgentApi } from './managedClient'
import { downloadName } from './downloadName'

type ArtifactEvent = Extract<AgentNormalizedEvent, { type: 'artifact' }>

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export const isInlineImageArtifact = (mediaType: string | undefined): boolean =>
  INLINE_IMAGE_TYPES.has(mediaType?.split(';', 1)[0]?.trim().toLowerCase() ?? '')

const artifactSize = (byteSize?: number): string =>
  byteSize == null ? '' : `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB · `

const dataUrl = async (bytes: Uint8Array, mediaType: string): Promise<string | null> => {
  if (typeof FileReader === 'undefined') return null
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(new Blob([bytes as unknown as BlobPart], { type: mediaType }))
  })
}

async function downloadArtifact(artifact: ArtifactEvent): Promise<void> {
  const { bytes, type, filename } = await managedAgentApi.artifactContent(artifact.artifactId)
  await saveFile({
    bytes,
    mimeType: type,
    suggestedName: filename ?? (downloadName(artifact.title, 180) || 'artifact'),
  })
}

function DownloadRow(props: { artifact: ArtifactEvent }) {
  return (
    <Row
      leading={<Icon name="paperclip" />}
      meta={<Text emphasis="muted">{artifactSize(props.artifact.byteSize)}Download →</Text>}
      onPress={() => void downloadArtifact(props.artifact)}
    >
      {props.artifact.title}
    </Row>
  )
}

export default function AgentArtifactCard(props: { artifact: ArtifactEvent }) {
  const [image] = createResource(
    () => isInlineImageArtifact(props.artifact.mediaType) ? props.artifact.artifactId : null,
    async (artifactId) => {
      const content = await managedAgentApi.artifactContent(artifactId).catch(() => null)
      if (!content || !isInlineImageArtifact(content.type)) return null
      return dataUrl(content.bytes, content.type)
    },
  )
  const alt = () => props.artifact.title.replaceAll('[', '').replaceAll(']', '').trim() || 'Generated image'

  return (
    <Show when={isInlineImageArtifact(props.artifact.mediaType)} fallback={<DownloadRow artifact={props.artifact} />}>
      <Card pad="sm">
        <Stack gap="row">
          <Show when={image()}>
            {(source) => <Markdown text={`![${alt()}](${source()})`} images="inline" />}
          </Show>
          <DownloadRow artifact={props.artifact} />
        </Stack>
      </Card>
    </Show>
  )
}
