import { activeNodeId } from '@acorn/plugin-api/client'
import { createMemo, onCleanup } from 'solid-js'
import { managedAgentApi } from './managedClient'
import { dataUrl, isInlineImageType, MAX_INLINE_IMAGE_BYTES } from './inlineImage'
import type { AgentAttachment } from '../../contract/wire.ts'

type Kind = 'attachment' | 'artifact'
type Content = Awaited<ReturnType<typeof managedAgentApi.attachmentContent>>
type Preview = { mediaType?: string; byteSize?: number }
const IDLE_BYTES = 16 * 1024 * 1024
const entries = new Map<string, ReturnType<typeof mediaEntry>>()

function mediaEntry(kind: Kind, id: string, nodeId: string | null, key: string) {
  const origin = { nodeId }
  let holders = 0
  let pending = 0
  let retained = 0
  let metadata: Promise<AgentAttachment> | undefined
  let content: Promise<Content> | undefined
  let source: Promise<string | null> | undefined
  const forget = () => { if (entries.get(key) === entry) entries.delete(key) }
  const run = async <T>(read: () => Promise<T>): Promise<T> => {
    pending++
    try { return await read() } catch (error) { forget(); throw error }
    finally { pending--; trimMedia() }
  }
  const attachment = () => metadata ??= run(() => managedAgentApi.attachment(id, origin))
  const bytes = (preview = false) => content ??= run(async () => {
    const result = await (kind === 'attachment'
      ? preview ? managedAgentApi.attachmentPreview(id, origin) : managedAgentApi.attachmentContent(id, origin)
      : preview ? managedAgentApi.artifactPreview(id, origin) : managedAgentApi.artifactContent(id, origin))
    retained += result.bytes.byteLength
    return result
  })
  const entry = {
    attachment, content: () => bytes(),
    preview: (descriptor?: Preview) => source ??= run(async () => {
      const info = descriptor ?? await attachment()
      if (!isInlineImageType(info.mediaType) || (info.byteSize !== undefined && info.byteSize > MAX_INLINE_IMAGE_BYTES)) return null
      const result = await bytes(true)
      const url = await dataUrl(result.bytes, result.type)
      retained += (url?.length ?? 0) * 2
      return url
    }),
    idle: () => !holders && !pending,
    size: () => retained,
    hold() {
      holders++
      let released = false
      return () => {
        if (released) return
        released = true
        holders--
        if (!holders && entries.get(key) === entry) {
          entries.delete(key); entries.set(key, entry)
        }
        trimMedia()
      }
    },
  }
  return entry
}

function trimMedia(): void {
  const idle = [...entries].filter(([, entry]) => entry.idle())
  let size = idle.reduce((total, [, entry]) => total + entry.size(), 0)
  for (const [key, entry] of idle) {
    // Metadata-only and failed previews need no idle entry. No TTL changes immutable byte identity.
    if (entry.size() && size <= IDLE_BYTES) continue
    entries.delete(key)
    size -= entry.size()
  }
}

/** One consumer's lease. Releasing it never aborts another consumer's read. */
export function holdAgentMedia(kind: Kind, id: string, nodeId: string | null = activeNodeId()) {
  const key = JSON.stringify([nodeId, kind, id])
  let entry = entries.get(key)
  if (!entry) { entry = mediaEntry(kind, id, nodeId, key); entries.set(key, entry) }
  return { ...entry, release: entry.hold() }
}

/** Follows both the Node and media identity and releases each departed owner. */
export function createAgentMedia(kind: Kind, id: () => string) {
  return createMemo(() => {
    const lease = holdAgentMedia(kind, id(), activeNodeId())
    onCleanup(lease.release)
    return lease
  })
}
