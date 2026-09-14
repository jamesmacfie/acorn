import { createResource, Show } from 'solid-js'
import type { AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'
import { saveFile } from '@acorn/plugin-api/client'
import { Card, Icon, Markdown, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { managedAgentApi } from './managedClient'
import { downloadName } from './downloadName'
import { dataUrl, imageAlt, isInlineImageType } from './inlineImage'

type ArtifactEvent = Extract<AgentNormalizedEvent, { type: 'artifact' }>

const artifactSize = (byteSize?: number): string =>
  byteSize == null ? '' : `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB · `

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
    () => isInlineImageType(props.artifact.mediaType) ? props.artifact.artifactId : null,
    async (artifactId) => {
      const content = await managedAgentApi.artifactContent(artifactId).catch(() => null)
      if (!content || !isInlineImageType(content.type)) return null
      return dataUrl(content.bytes, content.type)
    },
  )
  const alt = () => imageAlt(props.artifact.title) || 'Generated image'

  return (
    <Show when={isInlineImageType(props.artifact.mediaType)} fallback={<DownloadRow artifact={props.artifact} />}>
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
