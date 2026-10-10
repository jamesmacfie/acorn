import { lazy, Show, type JSX } from 'solid-js'
import { CORE_MARKDOWN_FENCE_POINT } from '@acorn/protocol/extensionPoints.ts'
import type { MarkdownFenceAdapter } from '../../kit/lib/rendering/markdown'
import { Button } from '../../kit/components/primitives'
import { createFenceViewers, type FenceScope, type FenceViewer } from './fenceViewers'
import './markdown-fences.css'

// Lazy, because a tree host draws this view for a pane's `Markdown` node and `Slot` draws a tree host:
// a static import would close that loop. Any transcript has loaded it long before a fence previews.
const Slot = lazy(() => import('../tree/Slot').then((module) => ({ default: module.Slot })))

/**
 * The desktop's fence viewers for one content owner, as the adapter the kit's `Markdown` takes. Call
 * it once in the owner's component and pass the result as `fences`.
 *
 * The Preview toggle sits beside the fence's copy button, and both stay outside the viewer, so the
 * source and copying it are always one press away whoever draws the fence.
 */
export function markdownFences(scope: FenceScope): MarkdownFenceAdapter<JSX.Element> {
  const viewers = createFenceViewers(scope)
  return (fence) => {
    const viewer = viewers(fence)
    return viewer && { preview: viewer.preview, view: <FenceView viewer={viewer} scope={scope} /> }
  }
}

function FenceView(props: { viewer: FenceViewer; scope: FenceScope }) {
  const viewer = props.viewer
  return (
    <Show when={viewer.pluginId()}>
      {(pluginId) => (
        <>
          <div class="markdown-fence-toggle">
            <Button size="xs" variant="ghost" pressed={viewer.preview()} tip={`Drawn by ${pluginId()}`} onPress={viewer.toggle}>
              Preview
            </Button>
          </div>
          <Show when={viewer.preview()}>
            <div class="markdown-fence-view">
              <Slot
                point={CORE_MARKDOWN_FENCE_POINT}
                key={viewer.key}
                props={() => viewer.props}
                {...(props.scope.taskId ? { taskId: props.scope.taskId } : {})}
                {...(props.scope.projectId ? { projectId: props.scope.projectId } : {})}
                // A contributor that goes away hides this whole view first; a tree that failed leaves the
                // slot drawing its empty default, so the fence falls back to its source.
                occupied={(occupied) => { if (!occupied && viewer.pluginId()) viewer.failed() }}
              />
            </div>
          </Show>
        </>
      )}
    </Show>
  )
}
