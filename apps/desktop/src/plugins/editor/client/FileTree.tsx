import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
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
  return (
    <Tree
      taskId={props.taskId}
      relPath=""
      onOpen={props.onOpen}
      openPath={props.openPath}
      reveal={props.reveal}
      onRevealed={props.onRevealed}
    />
  )
}

// A directory's children, listed lazily on mount (so a folder's contents load only when expanded).
function Tree(props: {
  taskId: string
  relPath: string
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
    <ul class="tree">
      <For each={entries()}>
        {(entry) => (
          <TreeNode
            taskId={props.taskId}
            parent={props.relPath}
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
  entry: EditorEntry
  onOpen: (path: string) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (revision: number) => void
}) {
  let fileButton: HTMLButtonElement | undefined
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
        fileButton?.scrollIntoView({ block: 'nearest' })
        props.onRevealed(request.revision)
      })
    }
  })

  return (
    <li>
      <Show
        when={props.entry.dir}
        fallback={
          <button ref={fileButton} type="button" class="tree-file" classList={{ active: props.openPath === path() }} onClick={() => props.onOpen(path())}>
            <span class="tree-twist" />
            {props.entry.name}
          </button>
        }
      >
        <button type="button" class="tree-dir" onClick={() => setOpen(!open())}>
          <span class="tree-twist">{open() ? '▾' : '▸'}</span>
          {props.entry.name}
        </button>
        <Show when={open()}>
          <Tree
            taskId={props.taskId}
            relPath={path()}
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
