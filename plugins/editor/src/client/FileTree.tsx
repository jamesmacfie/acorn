import { createEffect, createMemo, createSignal, onMount } from 'solid-js'
import { revealCollectionItem } from '@acorn/plugin-api/client'
import { Rows, TreeRow } from '@acorn/plugin-api/ui'
import { editorApi, type EditorEntry } from './editorClient'
import { editorTreeDirectoryOpen, setEditorTreeDirectoryOpen } from './editorTreeState'
import { type FileTreeRevealRequest } from './fileTreeReveal'

/** The collection id, so the reveal below and the host's stored place agree on one name. */
const TREE = 'editor.file-tree'

export default function FileTree(props: {
  taskId: string
  onOpen: (path: string) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (revision: number) => void
}) {
  const api = editorApi()
  // One directory's listing per key, fetched the first time the directory is opened and kept after it
  // closes: reopening a folder is instant and the tree's shape is stable across a collapse. `''` is
  // the worktree root, which is the one listing fetched without being asked for.
  const [listings, setListings] = createSignal<ReadonlyMap<string, EditorEntry[]>>(new Map())

  const load = async (dir: string): Promise<void> => {
    if (!api || listings().has(dir)) return
    const entries = await api.list(props.taskId, dir)
    setListings((current) => new Map(current).set(dir, entries))
  }
  onMount(() => void load(''))

  const isOpen = (path: string) => editorTreeDirectoryOpen(props.taskId, path)
  const setOpen = (path: string, open: boolean) => {
    setEditorTreeDirectoryOpen(props.taskId, path, open)
    if (open) void load(path)
  }

  // The visible rows, flat. A tree is a flat collection with a depth on each row, which is what lets
  // the host own arrow keys, type-ahead, `aria-activedescendant` and the roving stop: the recursive
  // component this replaced had a `<ul>` per directory and no keyboard at all.
  type TreeItem = { key: string; label: string; depth: number; dir: boolean }
  const items = createMemo<TreeItem[]>(() => {
    const rows: TreeItem[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of listings().get(dir) ?? []) {
        const path = dir ? `${dir}/${entry.name}` : entry.name
        rows.push({ key: path, label: entry.name, depth, dir: entry.dir })
        if (entry.dir && isOpen(path)) walk(path, depth + 1)
      }
    }
    walk('', 0)
    return rows
  })

  // Reveal: open every directory above the file, waiting for each listing before asking for the next,
  // then put the row in view. Sequential because a child directory cannot be opened until its parent's
  // listing has arrived, and `revealCollectionItem` is a no-op for a key the collection does not hold.
  createEffect(() => {
    const request = props.reveal
    if (!request) return
    void (async () => {
      const segments = request.path.split('/').slice(0, -1)
      let dir = ''
      for (const segment of segments) {
        dir = dir ? `${dir}/${segment}` : segment
        setEditorTreeDirectoryOpen(props.taskId, dir, true)
        await load(dir)
      }
      revealCollectionItem(TREE, request.path)
      props.onRevealed(request.revision)
    })()
  })

  return (
    <Rows
      id={TREE}
      tree
      ariaLabel="Worktree files"
      items={items()}
      selected={props.openPath}
      onActivate={(key) => {
        const item = items().find((candidate) => candidate.key === key)
        if (item && !item.dir) props.onOpen(key)
      }}
      // The left and right arrows, from the host's tree collection. Clicking the twist goes through
      // `onToggle` below; both land in the same place.
      //
      // `false` on a file, because a file does not fold and a handler that claims the key anyway is a
      // key that does nothing: the host gives it back to the tier below instead, which in the
      // terminal is the column move that takes the reader from the tree to the document beside it
      // (docs/command-palette-and-shortcuts.md § Focus and typing).
      onExpand={(key, expand) => {
        if (!items().find((item) => item.key === key)?.dir) return false
        setOpen(key, expand)
        return true
      }}
    >
      {(item, itemProps, selected) => (
        <TreeRow
          item={itemProps}
          depth={item.depth}
          selected={selected()}
          expandable={item.dir}
          expanded={item.dir ? isOpen(item.key) : undefined}
          onToggle={() => setOpen(item.key, !isOpen(item.key))}
          onPress={() => (item.dir ? setOpen(item.key, !isOpen(item.key)) : props.onOpen(item.key))}
          title={item.key}
        >
          {item.label}
        </TreeRow>
      )}
    </Rows>
  )
}
