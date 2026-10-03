import { useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { activeNodeId, queryOwner, revealCollectionItem, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'
import { Alert, Button, Rows, Stack, TreeRow } from '@acorn/plugin-api/ui'
import { editorApi, type EditorEntry } from './editorClient'
import { editorTreeDirectoryOpen, setEditorTreeDirectoryOpen } from './editorTreeState'
import { type FileTreeRevealRequest } from './fileTreeReveal'

/** The collection id, so the reveal below and the host's stored place agree on one name. */
const TREE = 'editor.file-tree'

export default function FileTree(props: {
  taskId: string
  onOpen: (path: string, ephemeral: boolean) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (revision: number) => void
}) {
  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const api = editorApi(queryClient)
  const [listings, setListings] = createSignal<ReadonlyMap<string, EditorEntry[]>>(new Map())
  const [errors, setErrors] = createSignal<ReadonlyMap<string, string>>(new Map())
  const loading = new Map<string, { generation: number; run: Promise<boolean> }>()
  let generation = 0
  let disposed = false
  let taskId = props.taskId
  const live = (revision: number, task: string) => !disposed && revision === generation && taskId === task && activeNodeId() === nodeId

  const load = (dir: string, refresh = false): Promise<boolean> => {
    const running = loading.get(dir)
    if (running?.generation === generation) return running.run
    if (!refresh && listings().has(dir)) return Promise.resolve(true)
    const revision = generation
    const task = taskId
    let entry: { generation: number; run: Promise<boolean> }
    const run = Promise.resolve().then(() => api.list(task, dir)).then((entries) => {
      if (!live(revision, task)) return false
      setErrors((current) => { const next = new Map(current); next.delete(dir); return next })
      setListings((current) => new Map(current).set(dir, entries))
      return true
    }).catch((cause: unknown) => {
      if (live(revision, task)) setErrors((current) => new Map(current).set(dir,
        cause instanceof Error ? cause.message : 'Unable to read directory.'))
      return false
    }).finally(() => {
      if (loading.get(dir) === entry) loading.delete(dir)
    })
    entry = { generation: revision, run }
    loading.set(dir, entry)
    return run
  }

  // No path is carried by the worktree event. Refresh loaded directories in parent order;
  // unopened directories stay lazy, and previous successful listings survive failed reads.
  const refresh = async () => {
    const revision = ++generation
    const task = taskId
    const dirs = [...new Set(['', ...listings().keys(), ...loading.keys(), ...errors().keys()])]
      .sort((a, b) => a.split('/').length - b.split('/').length)
    for (const dir of dirs) {
      if (!live(revision, task)) return
      if (dir) {
        const split = dir.lastIndexOf('/')
        const parent = split < 0 ? '' : dir.slice(0, split)
        const name = dir.slice(split + 1)
        if (!listings().get(parent)?.some((entry) => entry.dir && entry.name === name)) {
          setListings((current) => { const next = new Map(current); next.delete(dir); return next })
          continue
        }
      }
      await load(dir, true)
    }
  }
  createEffect(() => {
    const next = props.taskId
    if (next === taskId) return
    taskId = next
    generation++
    loading.clear()
    setErrors(new Map())
    setListings(new Map())
    void load('')
  })
  onMount(() => {
    void load('')
    const offWorktree = wsOnNodeEvent('worktree:status-changed', (event) => {
      if (event.taskId === taskId && activeNodeId() === nodeId) void refresh()
    })
    const offReconnect = wsOnReconnect(() => { if (activeNodeId() === nodeId) void refresh() })
    const focus = () => { if (activeNodeId() === nodeId) void refresh() }
    if (typeof window !== 'undefined') window.addEventListener('focus', focus)
    onCleanup(() => {
      disposed = true
      generation++
      offWorktree()
      offReconnect()
      if (typeof window !== 'undefined') window.removeEventListener('focus', focus)
    })
  })

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

  // Expansion outlives this component, while its lazy listings do not. Rebuild every retained open
  // branch as its parent listing arrives, so returning to the pane cannot show an open twist beside
  // an empty folder. This also restores nested branches in order without fetching collapsed ones.
  createEffect(() => {
    for (const [dir, entries] of listings()) {
      for (const entry of entries) {
        if (!entry.dir) continue
        const path = dir ? `${dir}/${entry.name}` : entry.name
        if (isOpen(path) && !listings().has(path) && !errors().has(path)) void load(path)
      }
    }
  })

  // Reveal: open every directory above the file, waiting for each listing before asking for the next,
  // then put the row in view. Sequential because a child directory cannot be opened until its parent's
  // listing has arrived, and `revealCollectionItem` is a no-op for a key the collection does not hold.
  createEffect(on(() => [props.taskId, props.reveal] as const, ([, request]) => {
    if (!request) return
    const task = taskId
    const current = () => !disposed && task === taskId && props.reveal?.revision === request.revision
    void (async () => {
      if (!await load('') || !current()) return
      const segments = request.path.split('/').slice(0, -1)
      let dir = ''
      for (const segment of segments) {
        if (!current()) return
        dir = dir ? `${dir}/${segment}` : segment
        setEditorTreeDirectoryOpen(task, dir, true)
        if (!await load(dir) || !current()) return
      }
      if (!current()) return
      revealCollectionItem(TREE, request.path)
      props.onRevealed(request.revision)
    })()
  }))

  return (
    <Stack grow>
      {Array.from(errors()).map(([dir, message]) => <Alert tone="danger">{dir || 'Worktree'}: {message} <Button onPress={() => void load(dir, true)}>Retry</Button></Alert>)}
    <Rows
      virtual
      id={TREE}
      tree
      ariaLabel="Worktree files"
      items={items()}
      selected={props.openPath}
      onActivate={(key) => {
        const item = items().find((candidate) => candidate.key === key)
        if (item && !item.dir) props.onOpen(key, true)
      }}
      // The left and right arrows, from the host's tree collection. Clicking the twist goes through
      // `onToggle` below; both land in the same place.
      //
      // `false` on a file, because a file does not fold and a handler that claims the key anyway is a
      // key that does nothing: the host gives it back to the tier below instead, which in the
      // terminal is the column move that takes the reader from the tree to the document beside it
      // (docs/command-palette-and-shortcuts/focus-and-typing.md § Focus and typing).
      onExpand={(key, expand) => {
        if (!items().find((item) => item.key === key)?.dir) return false
        setOpen(key, expand)
        return true
      }}
    >
      {(item, itemProps, selected, place) => (
        <TreeRow
          item={itemProps}
          offset={place.offset}
          height={place.height}
          depth={item.depth}
          selected={selected()}
          expandable={item.dir}
          expanded={item.dir ? isOpen(item.key) : undefined}
          onToggle={() => setOpen(item.key, !isOpen(item.key))}
          onPress={() => (item.dir ? setOpen(item.key, !isOpen(item.key)) : props.onOpen(item.key, true))}
          onDoublePress={!item.dir ? () => props.onOpen(item.key, false) : undefined}
          title={item.key}
        >
          {item.label}
        </TreeRow>
      )}
    </Rows>
    </Stack>
  )
}
