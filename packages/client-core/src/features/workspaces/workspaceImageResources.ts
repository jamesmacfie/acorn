import { createSignal, type Accessor } from 'solid-js'
import { readBytes } from '../../infra/node/apiClient'
import { WORKSPACE_IMAGE_BYTES, workspaceIconImageRoute } from '@acorn/protocol/workspaceAppearance.ts'

type ImageResource = { references: number; url: Accessor<string | undefined>; release: () => void }
const images = new Map<string, ImageResource>()

/** Share a broker read and object URL across every visible copy of one immutable Node image. */
export function acquireWorkspaceImage(nodeId: string, imageId: string): ImageResource {
  const key = JSON.stringify([nodeId, imageId])
  const existing = images.get(key)
  if (existing) { existing.references++; return existing }
  const [url, setUrl] = createSignal<string>()
  const abort = new AbortController()
  let disposed = false
  const resource: ImageResource = {
    references: 1, url,
    release: () => {
      if (--resource.references > 0) return
      // A query refresh can replace rows in the same turn. Let their replacement acquire the
      // shared resource before deciding its last consumer has gone.
      queueMicrotask(() => {
        if (resource.references > 0 || disposed) return
        disposed = true
        abort.abort()
        const value = url()
        if (value) URL.revokeObjectURL(value)
        images.delete(key)
      })
    },
  }
  images.set(key, resource)
  void readBytes(workspaceIconImageRoute(imageId), 'Could not load workspace image.', {
    nodeId, signal: abort.signal, maxResponseBytes: WORKSPACE_IMAGE_BYTES,
  }).then(({ bytes, type }) => {
    if (disposed || type.split(';')[0] !== 'image/png') return
    setUrl(URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' })))
  }).catch(() => { /* An unavailable image resolves to initials. Keep its saved reference. */ })
  return resource
}
