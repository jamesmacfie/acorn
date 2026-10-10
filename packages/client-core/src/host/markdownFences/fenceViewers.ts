import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { CORE_MARKDOWN_FENCE_POINT, markdownFenceKey, type MarkdownFenceProps } from '@acorn/protocol/extensionPoints.ts'
import type { MarkdownFence } from '../../kit/lib/rendering/markdown'
import { extensionPointRegistry } from '../registries/extensionPoints/extensionPoints'
import { resolveSlot } from '../tree/arbitration'
import { createSlotChoice } from '../tree/slotChoice'

// Other plugins' viewers for code fences in host-owned Markdown (docs/plugins/markdown-fences.md §
// How the host draws it).
//
// This module decides, for one content owner, which fences get a viewer: a block's identity, who would
// draw it, the Source/Preview choice, and the cap. It draws nothing. The desktop draws the control and
// the slot in MarkdownFences.tsx and the terminal in its kit host, and both hand the kit's `Markdown`
// node the adapter they build from this.

// Registered where the rule is, like `core:link-preview`: both hosts import this module.
extensionPointRegistry.register({
  id: CORE_MARKDOWN_FENCE_POINT,
  ownerId: 'core',
  label: 'Markdown fence viewer',
  kind: 'remote',
  mode: 'replace',
  max: 1,
})

/** How many fences in one content owner may have a viewer mounted at once. */
export const MAX_FENCE_VIEWERS = 4

/** The task or project of the content the fences sit in. The owner's, never the shell's active task. */
export type FenceScope = { taskId?: string; projectId?: string }

export type FenceViewer = {
  /** The point's key: the lowercased hint. */
  key: string
  props: MarkdownFenceProps
  /** Who would draw this fence, while exactly one plugin would. */
  pluginId: () => string | undefined
  /** Whether the viewer stands in for the source right now. */
  preview: () => boolean
  /** Source to Preview and back. Previewing past the cap sends the earliest open fence back to source. */
  toggle: () => void
  /** The viewer's tree failed, so the fence stays source for the rest of its life. */
  failed: () => void
}

/**
 * One content owner's fences. Call it once under the owner. Call what it returns once per closed fence,
 * under that fence's own root, so the fence's place in the cap is given back when its block goes.
 *
 * The first four fences somebody can draw open on their own, in the order they appear. Later ones stay
 * source until a person asks. Choices are held here until the owner unmounts and are never stored.
 */
export function createFenceViewers(scope: FenceScope): (fence: MarkdownFence) => FenceViewer | undefined {
  let blocks = 0
  const [open, setOpen] = createSignal<readonly string[]>([])
  return (fence) => {
    const key = markdownFenceKey(fence)
    if (!key) return undefined
    const blockId = `fence-${++blocks}`
    const choice = createSlotChoice(() => CORE_MARKDOWN_FENCE_POINT, () => key)
    const [broken, setBroken] = createSignal(false)
    // The rule `Slot` draws by, asked before mounting one, so a fence nobody can draw, or one waiting
    // past the cap, starts no worker. A tie with no pick draws nothing, so it counts as nobody.
    const pluginId = createMemo(() => {
      const point = extensionPointRegistry.get(CORE_MARKDOWN_FENCE_POINT)
      return point && !broken() ? resolveSlot(point, key, choice).occupants[0]?.pluginId : undefined
    })
    const isOpen = () => open().includes(blockId)
    let offered = false
    createEffect(() => {
      if (offered || !pluginId()) return
      offered = true
      if (untrack(open).length < MAX_FENCE_VIEWERS) setOpen((ids) => [...ids, blockId])
    })
    onCleanup(() => setOpen((ids) => ids.filter((id) => id !== blockId)))
    return {
      key,
      props: {
        blockId,
        language: fence.language,
        text: fence.text,
        revision: fence.revision,
        ...(scope.taskId ? { taskId: scope.taskId } : {}),
        ...(scope.projectId ? { projectId: scope.projectId } : {}),
      },
      pluginId,
      preview: () => !!pluginId() && isOpen(),
      toggle: () => setOpen((ids) => (ids.includes(blockId)
        ? ids.filter((id) => id !== blockId)
        : [...ids, blockId].slice(-MAX_FENCE_VIEWERS))),
      failed: () => setBroken(true),
    }
  }
}

/** The `markdownFences` prop a tree host gets from a `RemoteTree`: the tree's bound task and project
 *  when it opted in, and nothing at all otherwise. */
export const fenceScope = (optedIn: boolean | undefined, bound: FenceScope): { markdownFences?: FenceScope } =>
  optedIn
    ? { markdownFences: { ...(bound.taskId ? { taskId: bound.taskId } : {}), ...(bound.projectId ? { projectId: bound.projectId } : {}) } }
    : {}
