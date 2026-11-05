import type { KnownValueMatch } from '@acorn/protocol/secretChecks.ts'
import type { AgentNormalizedEvent, AgentToolCall } from '../../contract/wire.ts'
import type { AgentDriverEvent } from '../drivers/types'
import type { AgentArtifactStore } from './artifactStore'
import { boundProviderEvent } from './boundProviderEvent'

const MAX_INLINE_TOOL_BYTES = 64 * 1024
const MAX_GENERATED_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_CHECKED_CALLS = 1_000

const boundedMediaType = (value: string): string => {
  const mediaType = value.trim().slice(0, 200)
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mediaType) ? mediaType : 'application/octet-stream'
}

/**
 * Bounds provider-owned display data and promotes oversized output into Acorn artifacts before an
 * event reaches SQLite or the client. Delta accounting is isolated from process supervision so
 * the runtime engine only coordinates ordered acceptance and persistence.
 */
export class ProviderEventMaterializer {
  readonly #toolOutputBytes = new Map<string, number>()
  // Calls whose input was already looked up. Codex repeats a call's input when it completes, and
  // one lookup and one audit row per call is enough: the fold keeps the first answer.
  readonly #checkedCalls = new Set<string>()

  constructor(
    private readonly artifacts: AgentArtifactStore,
    private readonly secretValues: string[],
    // The known key values a call's input carried. Advisory: it fails open to none.
    private readonly carriedKeys: (sessionId: string, tool: AgentToolCall) => Promise<KnownValueMatch[]>,
  ) {}

  clear(): void {
    this.#toolOutputBytes.clear()
    this.#checkedCalls.clear()
  }

  async map(
    sessionId: string,
    turnId: string | null,
    attributedEvent: AgentDriverEvent,
  ): Promise<AgentNormalizedEvent[]> {
    const { acornTurnId: _turnId, ...providerEvent } = attributedEvent
    // ManagedAgentEngine rewrites one it knows as the steered turn's message before this point.
    if (providerEvent.type === 'steer_taken') return []
    if (providerEvent.type === 'generated_artifact') {
      if (providerEvent.bytes.byteLength === 0 || providerEvent.bytes.byteLength > MAX_GENERATED_ARTIFACT_BYTES) {
        return [
          {
            type: 'diagnostic',
            level: 'warning',
            message:
              providerEvent.bytes.byteLength === 0
                ? 'The provider returned an empty generated artifact.'
                : 'The provider returned a generated artifact larger than 16 MiB.',
          },
        ]
      }
      const artifact = await this.artifacts.putBytes({
        sessionId,
        turnId,
        kind: providerEvent.kind,
        title: providerEvent.title.slice(0, 500),
        bytes: providerEvent.bytes,
        mediaType: boundedMediaType(providerEvent.mediaType),
      })
      return [
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
    // The subject and the parked-request handles stay in the driver's event; only the request is kept.
    const event = boundProviderEvent(
      providerEvent.type === 'permission_request' || providerEvent.type === 'input_request'
        ? providerEvent.request
        : providerEvent,
      this.secretValues,
    )
    if (event.type === 'tool') {
      const key = `${sessionId}:${turnId ?? 'session'}:${event.tool.id}`
      // Before an oversized input moves to an artifact, so the lookup reads the whole of it.
      if (event.tool.input && !this.#checkedCalls.has(key)) {
        this.#checkedCalls.add(key)
        if (this.#checkedCalls.size > MAX_CHECKED_CALLS)
          this.#checkedCalls.delete(this.#checkedCalls.values().next().value!)
        const secretValues = await this.carriedKeys(sessionId, event.tool)
        if (secretValues.length) event.tool = { ...event.tool, secretValues }
      }
      if (event.tool.outputAppend && event.tool.output != null) {
        const used = this.#toolOutputBytes.get(key) ?? 0
        const bytes = Buffer.byteLength(event.tool.output, 'utf8')
        this.#toolOutputBytes.set(key, used + bytes)
        if (used >= MAX_INLINE_TOOL_BYTES) return []
        if (used + bytes > MAX_INLINE_TOOL_BYTES) {
          return [
            {
              ...event,
              tool: {
                ...event.tool,
                output: Buffer.from(event.tool.output)
                  .subarray(0, MAX_INLINE_TOOL_BYTES - used)
                  .toString('utf8'),
              },
            },
          ]
        }
        return [event]
      }
      this.#toolOutputBytes.delete(key)
      const oversizedField = [
        event.tool.output != null ? (['output', event.tool.output] as const) : null,
        event.tool.input != null ? (['input', event.tool.input] as const) : null,
      ].find(
        (item): item is readonly ['output' | 'input', string] =>
          item != null && Buffer.byteLength(item[1], 'utf8') > MAX_INLINE_TOOL_BYTES,
      )
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
    if (event.type === 'file_change' && event.patch && Buffer.byteLength(event.patch, 'utf8') > MAX_INLINE_TOOL_BYTES) {
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
        {
          ...event,
          patch: undefined,
          patchArtifactId: artifact.id,
          summary: event.summary ?? 'Large patch stored as an artifact.',
        },
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
