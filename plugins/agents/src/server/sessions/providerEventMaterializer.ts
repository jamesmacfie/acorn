import type { AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'
import type { AgentDriverEvent } from '../drivers/types'
import type { AgentArtifactStore } from './artifactStore'
import { boundProviderEvent } from './boundProviderEvent'

const MAX_INLINE_TOOL_BYTES = 64 * 1024
const MAX_GENERATED_ARTIFACT_BYTES = 16 * 1024 * 1024

const boundedMediaType = (value: string): string => {
  const mediaType = value.trim().slice(0, 200)
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mediaType)
    ? mediaType
    : 'application/octet-stream'
}

/**
 * Bounds provider-owned display data and promotes oversized output into Acorn artifacts before an
 * event reaches SQLite or the client. Delta accounting is isolated from process supervision so
 * the runtime engine only coordinates ordered acceptance and persistence.
 */
export class ProviderEventMaterializer {
  readonly #toolOutputBytes = new Map<string, number>()

  constructor(
    private readonly artifacts: AgentArtifactStore,
    private readonly secretValues: string[],
  ) {}

  clear(): void {
    this.#toolOutputBytes.clear()
  }

  async map(
    sessionId: string,
    turnId: string | null,
    providerEvent: AgentDriverEvent,
  ): Promise<AgentNormalizedEvent[]> {
    if (providerEvent.type === 'generated_artifact') {
      if (providerEvent.bytes.byteLength === 0 || providerEvent.bytes.byteLength > MAX_GENERATED_ARTIFACT_BYTES) {
        return [{
          type: 'diagnostic',
          level: 'warning',
          message: providerEvent.bytes.byteLength === 0
            ? 'The provider returned an empty generated artifact.'
            : 'The provider returned a generated artifact larger than 16 MiB.',
        }]
      }
      const artifact = await this.artifacts.putBytes({
        sessionId,
        turnId,
        kind: providerEvent.kind,
        title: providerEvent.title.slice(0, 500),
        bytes: providerEvent.bytes,
        mediaType: boundedMediaType(providerEvent.mediaType),
      })
      return [{
        type: 'artifact',
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        mediaType: artifact.mediaType ?? undefined,
        byteSize: artifact.byteSize ?? undefined,
      }]
    }
    const event = boundProviderEvent(providerEvent, this.secretValues)
    if (event.type === 'tool') {
      const key = `${sessionId}:${turnId ?? 'session'}:${event.tool.id}`
      if (event.tool.outputAppend && event.tool.output != null) {
        const used = this.#toolOutputBytes.get(key) ?? 0
        const bytes = Buffer.byteLength(event.tool.output, 'utf8')
        this.#toolOutputBytes.set(key, used + bytes)
        if (used >= MAX_INLINE_TOOL_BYTES) return []
        if (used + bytes > MAX_INLINE_TOOL_BYTES) {
          return [{
            ...event,
            tool: {
              ...event.tool,
              output: Buffer.from(event.tool.output)
                .subarray(0, MAX_INLINE_TOOL_BYTES - used)
                .toString('utf8'),
            },
          }]
        }
        return [event]
      }
      this.#toolOutputBytes.delete(key)
      const oversizedField = [
        event.tool.output != null ? ['output', event.tool.output] as const : null,
        event.tool.input != null ? ['input', event.tool.input] as const : null,
      ].find((item): item is readonly ['output' | 'input', string] =>
        item != null && Buffer.byteLength(item[1], 'utf8') > MAX_INLINE_TOOL_BYTES)
      if (!oversizedField) return [event]
      const [field, text] = oversizedField
      const artifact = await this.artifacts.putText({
        sessionId,
        turnId,
        kind: 'command_output',
        title: `${event.tool.title} · ${field}`,
        text,
        metadata: { toolId: event.tool.id, field },
      })
      return [
        {
          ...event,
          tool: {
            ...event.tool,
            [field]: `[${artifact.byteSize?.toLocaleString() ?? 'Large'} bytes stored as artifact: ${artifact.title}]`,
          },
        },
        {
          type: 'artifact',
          artifactId: artifact.id,
          kind: artifact.kind,
          title: artifact.title,
          mediaType: artifact.mediaType ?? undefined,
          byteSize: artifact.byteSize ?? undefined,
        },
      ]
    }
    if (event.type === 'file_change' && event.patch
      && Buffer.byteLength(event.patch, 'utf8') > MAX_INLINE_TOOL_BYTES) {
      const artifact = await this.artifacts.putText({
        sessionId,
        turnId,
        kind: 'patch',
        title: event.path ? `Patch · ${event.path}` : 'Agent patch',
        text: event.patch,
        mediaType: 'text/x-diff; charset=utf-8',
        metadata: { path: event.path },
      })
      return [
        { ...event, patch: undefined, summary: event.summary ?? 'Large patch stored as an artifact.' },
        {
          type: 'artifact',
          artifactId: artifact.id,
          kind: 'patch',
          title: artifact.title,
          mediaType: artifact.mediaType ?? undefined,
          byteSize: artifact.byteSize ?? undefined,
        },
      ]
    }
    return [event]
  }
}
