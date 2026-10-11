import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { latestSignal } from '@acorn/plugin-api/client'
import { EmptyState, Stack } from '@acorn/plugin-api/ui'
import { imageTypeForPath } from '../contract/imagePreview'
import { editorApi } from './editorClient'

// The editor owns the tab; this view only owns the disposable URL for its current image bytes.
export default function ImagePreview(props: { taskId: string; path: string }) {
  const [source, setSource] = createSignal<string | null>(null)
  const [error, setError] = createSignal(false)
  let currentUrl: string | null = null
  let disposed = false
  const imageRead = latestSignal()

  const load = async () => {
    const signal = imageRead.next()
    try {
      const image = await editorApi().readImage(props.taskId, props.path)
      if (disposed || signal.aborted) return
      if (image.type.split(';', 1)[0]?.toLowerCase() !== imageTypeForPath(props.path))
        throw new Error('Unexpected image type')
      const nextUrl = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.type }))
      const previous = currentUrl
      currentUrl = nextUrl
      setSource(nextUrl)
      setError(false)
      if (previous) URL.revokeObjectURL(previous)
    } catch {
      if (disposed || signal.aborted) return
      showError()
    }
  }

  const showError = () => {
    if (currentUrl) URL.revokeObjectURL(currentUrl)
    currentUrl = null
    setSource(null)
    setError(true)
  }

  onMount(() => {
    void load()
    window.addEventListener('focus', load)
    onCleanup(() => {
      disposed = true
      imageRead.abort()
      window.removeEventListener('focus', load)
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    })
  })

  return (
    <Stack grow>
      <Show
        when={source()}
        fallback={
          <EmptyState busy={!error()}>{error() ? 'Unable to preview this image.' : 'Loading image…'}</EmptyState>
        }
      >
        {(url) => (
          <img
            src={url()}
            alt={props.path.split('/').pop() ?? props.path}
            onError={showError}
            style={{ 'max-width': '100%', 'max-height': '100%', 'object-fit': 'contain', margin: 'auto' }}
          />
        )}
      </Show>
    </Stack>
  )
}
