import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import { TreeRow } from '@acorn/plugin-api/ui'
import { editorApi, type EditorEntry } from './editorClient'
import { editorTreeDirectoryOpen, setEditorTreeDirectoryOpen } from './editorTreeState'
import { directoryContainsFile, type FileTreeRevealRequest } from './fileTreeReveal'

export default function FileTree(props: {
  taskId: string
  onOpen: (path: string) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (revision: number) => void
}) {
  // The tree's container semantics live here, which is what TreeRow's contract requires: a row
  // cannot know its tree. There were none of these before.
  return (
    <div role="tree" aria-label="Worktree files">
      <Tree
        taskId={props.taskId}
        relPath=""
        depth={0}
        onOpen={props.onOpen}
        openPath={props.openPath}
        reveal={props.reveal}
        onRevealed={props.onRevealed}
      />
    </div>
  )
}

// A directory's children, listed lazily on mount (so a folder's contents load only when expanded).
function Tree(props: {
  taskId: string
  relPath: string
  depth: number
  onOpen: (path: string) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (revision: number) => void
}) {
  const api = editorApi()
  const [entries, setEntries] = createSignal<EditorEntry[]>([])
  onMount(() => {
    void (async () => {
      if (api) setEntries(await api.list(props.taskId, props.relPath))
    })()
  })
  return (
    <ul class="tree" role="group">
      <For each={entries()}>
        {(entry) => (
          <TreeNode
            taskId={props.taskId}
            parent={props.relPath}
            depth={props.depth}
            entry={entry}
            onOpen={props.onOpen}
            openPath={props.openPath}
            reveal={props.reveal}
            onRevealed={props.onRevealed}
          />
        )}
      </For>
    </ul>
  )
}

function TreeNode(props: {
  taskId: string
  parent: string
  depth: number
  entry: EditorEntry
  onOpen: (path: string) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (revision: number) => void
}) {
  // The <li>, not the row: TreeRow has no `ref` prop. A props member named `ref` silently becomes a
  // DOM setter in Solid, so naming it that would break rather than warn.
  let fileRow: HTMLLIElement | undefined
  const path = () => (props.parent ? `${props.parent}/${props.entry.name}` : props.entry.name)
  const open = () => editorTreeDirectoryOpen(props.taskId, path())
  const setOpen = (value: boolean) => setEditorTreeDirectoryOpen(props.taskId, path(), value)

  createEffect(() => {
    const request = props.reveal
    if (!request) return
    const nodePath = path()
    if (props.entry.dir && directoryContainsFile(nodePath, request.path)) {
      setOpen(true)
    } else if (!props.entry.dir && nodePath === request.path) {
      queueMicrotask(() => {
        fileRow?.scrollIntoView({ block: 'nearest' })
        props.onRevealed(request.revision)
      })
    }
  })

  return (
    // `aria-level` is 1-based; depth is 0-based, hence the +1.
    <li
      ref={(element) => { fileRow = element }}
      role="treeitem"
      aria-level={props.depth + 1}
      aria-expanded={props.entry.dir ? open() : undefined}
    >
      <Show
        when={props.entry.dir}
        fallback={
          <TreeRow
            class="tree-file"
            depth={props.depth}
            selected={props.openPath === path()}
            onActivate={() => props.onOpen(path())}
          >
            {props.entry.name}
          </TreeRow>
        }
      >
        {/* The twist was a ▾/▸ glyph literal; TreeRow draws it from the marker token, so it scales
            with the style pack rather than with a font. */}
        <TreeRow
          class="tree-dir"
          depth={props.depth}
          expandable
          expanded={open()}
          onToggle={() => setOpen(!open())}
          onActivate={() => setOpen(!open())}
        >
          {props.entry.name}
        </TreeRow>
        <Show when={open()}>
          <Tree
            taskId={props.taskId}
            relPath={path()}
            depth={props.depth + 1}
            onOpen={props.onOpen}
            openPath={props.openPath}
            reveal={props.reveal}
            onRevealed={props.onRevealed}
          />
        </Show>
      </Show>
    </li>
  )
}
