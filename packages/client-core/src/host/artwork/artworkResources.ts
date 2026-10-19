import { createSignal, type Accessor } from 'solid-js'
import { ARTWORK_MAX_BYTES, type ArtworkReference } from '@acorn/protocol/artwork.ts'
import { readBytes } from '../../infra/node/apiClient'
import { createLogger } from '../../infra/telemetry/logger'
import { ownedPluginPath } from '../chrome/ownership'
import { inspectArtwork } from './artworkBytes'

// One window's artwork: a broker read and a local object URL per Node, plugin, path, and revision,
// shared by every consumer of that identity and released when the last one leaves. The same shape as
// workspace images (features/workspaces/workspaceImageResources.ts), plus the read and memory ceilings
// a plugin-chosen picture needs. See docs/plugins/rail-presentation.md § Artwork bytes.

const log = createLogger('plugin-artwork')

/** Whose routes a reference addresses. Bound by the host from a registration or a tree mount. */
export type ArtworkOwner = { nodeId: string; pluginId: string }

/** `deferred` means the window's memory ceiling is full: the consumer draws its fallback until a
 *  release makes room, and the read starts then. */
export type ArtworkStatus = 'loading' | 'ready' | 'failed' | 'deferred'

type ArtworkResource = { status: Accessor<ArtworkStatus>; url: Accessor<string | undefined>; release(): void }

const MAX_READS = 4
const MAX_RESIDENT_BYTES = 32 * 1024 * 1024

type Entry = ArtworkResource & {
  references: number
  setStatus(status: ArtworkStatus): void
  start(): void
}

const entries = new Map<string, Entry>()
// Entries waiting for a read slot or for room, in the order they were asked for.
const waiting: Entry[] = []
let reading = 0
let resident = 0

// Each read in flight holds the largest answer it could bring, so a fourth read cannot push the
// window past its ceiling once the bytes land.
function pump(): void {
  while (waiting.length && reading < MAX_READS) {
    if (resident + (reading + 1) * ARTWORK_MAX_BYTES > MAX_RESIDENT_BYTES) {
      for (const entry of waiting) entry.setStatus('deferred')
      return
    }
    waiting.shift()!.start()
  }
}

type Failure = 'route' | 'request' | 'type' | 'format' | 'animated' | 'dimensions' | 'corrupt'

// The plugin and the category, never the path, the bytes, or the tooltip the picture belongs to.
const report = (pluginId: string, failure: Failure): void =>
  log.warn(`${pluginId} artwork could not be shown (${failure})`, undefined, {
    'plugin.id': pluginId,
    'artwork.failure': failure,
  })

// A full decode where the platform has one, because a valid header can sit on a corrupt body.
async function decodes(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== 'function') return true
  try {
    ;(await createImageBitmap(blob)).close()
    return true
  } catch {
    return false
  }
}

/** Share one checked read of a plugin's artwork. Release it when the consumer leaves. */
export function acquireArtwork(owner: ArtworkOwner, reference: Pick<ArtworkReference, 'path' | 'revision'>) {
  const key = JSON.stringify([owner.nodeId, owner.pluginId, reference.path, reference.revision])
  const existing = entries.get(key)
  if (existing) {
    existing.references++
    return existing
  }
  const [status, setStatus] = createSignal<ArtworkStatus>('loading')
  const [url, setUrl] = createSignal<string>()
  const abort = new AbortController()
  let disposed = false
  let size = 0
  const fail = (failure: Failure): void => {
    report(owner.pluginId, failure)
    setStatus('failed')
  }

  const read = async (path: string): Promise<void> => {
    const answer = await readBytes(path, 'Could not load artwork.', {
      nodeId: owner.nodeId,
      signal: abort.signal,
      maxResponseBytes: ARTWORK_MAX_BYTES,
      owner: owner.pluginId,
    }).catch(() => null)
    if (disposed) return
    if (!answer) return fail('request')
    const inspected = inspectArtwork(answer.bytes)
    if (!inspected.ok) return fail(inspected.failure)
    // The bytes decide the format; a content type that disagrees is a misconfigured route.
    if (answer.type.split(';')[0].trim().toLowerCase() !== inspected.type) return fail('type')
    const blob = new Blob([answer.bytes.slice().buffer], { type: inspected.type })
    if (!(await decodes(blob))) return disposed ? undefined : fail('corrupt')
    if (disposed) return
    size = answer.bytes.byteLength
    resident += size
    setUrl(URL.createObjectURL(blob))
    setStatus('ready')
  }

  const entry: Entry = {
    references: 1,
    status,
    url,
    setStatus,
    start: () => {
      const path = ownedPluginPath(owner.pluginId, reference.path)
      if (!path) return fail('route')
      setStatus('loading')
      reading++
      void read(path).finally(() => {
        reading--
        pump()
      })
    },
    release: () => {
      if (--entry.references > 0) return
      // A refetch can replace a consumer in the same turn. Let the replacement acquire the shared
      // entry before deciding its last consumer has gone.
      queueMicrotask(() => {
        if (entry.references > 0 || disposed) return
        disposed = true
        abort.abort()
        const queued = waiting.indexOf(entry)
        if (queued >= 0) waiting.splice(queued, 1)
        const value = url()
        if (value) URL.revokeObjectURL(value)
        resident -= size
        entries.delete(key)
        pump()
      })
    },
  }
  entries.set(key, entry)
  waiting.push(entry)
  pump()
  return entry as ArtworkResource
}
