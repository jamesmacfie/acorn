import { useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { activeNodeId, queryOwner, revealCollectionItem, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'
import { Alert, Button, Input, Menu, Modal, RowActions, Rows, Stack, Text, TreeRow } from '@acorn/plugin-api/ui'
import { editorApi, type EditorEntry } from './editorClient'
import type { FileTarget, TrashAvailability } from '../contract/api'
import type { ArmedFileAction } from './fileActionModel'
import { createFileActionModel } from './fileActionModel'
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
  actions: ReturnType<typeof createFileActionModel>
}) {
  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const api = editorApi(queryClient)
  const [listings, setListings] = createSignal<ReadonlyMap<string, EditorEntry[]>>(new Map())
  const [errors, setErrors] = createSignal<ReadonlyMap<string, string>>(new Map())
  const [rootEntry, setRootEntry] = createSignal<FileTarget | null>(null)
  const [trashSupport, setTrashSupport] = createSignal<TrashAvailability>({ available: false, reason: 'Checking Node trash support…' })
  const [menuPath, setMenuPath] = createSignal<string | null>(null)
  const [armed, setArmed] = createSignal<ArmedFileAction | null>(null)
  const [dialog, setDialog] = createSignal<'create-file' | 'create-folder' | 'rename' | 'trash' | null>(null)
  const [inlinePath, setInlinePath] = createSignal<string | null>(null)
  const [name, setName] = createSignal('')
  const [destinationFolder, setDestinationFolder] = createSignal('')
  const [actionError, setActionError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
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
    void api.entry(task, '').then((entry) => { if (live(revision, task)) setRootEntry(entry) }).catch(() => {})
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
    release()
    taskId = next
    generation++
    loading.clear()
    setErrors(new Map())
    setListings(new Map())
    setRootEntry(null)
    void load('')
    void api.entry(next, '').then((entry) => { if (taskId === next) setRootEntry(entry) }).catch(() => {})
  })
  onMount(() => {
    void load('')
    void api.entry(taskId, '').then(setRootEntry).catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)))
    void api.trashAvailability(taskId).then(setTrashSupport).catch((cause: unknown) => setTrashSupport({ available: false, reason: cause instanceof Error ? cause.message : String(cause) }))
    const offWorktree = wsOnNodeEvent('worktree:status-changed', (event) => {
      if (event.taskId === taskId && activeNodeId() === nodeId) void refresh()
    })
    const offReconnect = wsOnReconnect(() => { if (activeNodeId() === nodeId) void refresh() })
    const focus = () => { if (activeNodeId() === nodeId) void refresh() }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', focus)
    onCleanup(() => {
      disposed = true
      release()
      generation++
      offWorktree()
      offReconnect()
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', focus)
    })
  })

  const isOpen = (path: string) => editorTreeDirectoryOpen(props.taskId, path)

  const targetOf = (item: TreeItem): FileTarget | null => {
    const entry = listings().get(item.key.includes('/') ? item.key.slice(0, item.key.lastIndexOf('/')) : '')
      ?.find((candidate) => candidate.name === item.label)
    return entry?.identity && entry.kind && entry.root
      ? { path: item.key, kind: entry.kind, identity: entry.identity, root: entry.root }
      : null
  }
  const release = () => { armed()?.release(); setArmed(null); setMenuPath(null) }
  const dismissMenu = () => {
    const closing = armed()
    queueMicrotask(() => { if (!dialog() && armed() === closing) release() })
  }
  const prepareMenu = (target: FileTarget) => {
    if (armed()?.target.path === target.path) return
    release()
    try { setArmed(props.actions.arm(target)); setActionError('') }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const openMenu = (target: FileTarget) => { prepareMenu(target); if (armed()) setMenuPath(target.path) }
  const begin = (next: 'create-file' | 'create-folder' | 'rename' | 'trash') => {
    const target = armed()?.target
    if (!target) return
    setName(next === 'rename' ? target.path.split('/').pop() ?? '' : '')
    setDestinationFolder('')
    setActionError('')
    setDialog(next)
    setInlinePath(next !== 'trash' && target.path && items().some((item) => item.key === target.path) ? target.path : null)
    setMenuPath(null)
  }
  const finish = () => { setDialog(null); setInlinePath(null); release() }
  const act = async (saveDrafts = false, suppliedName?: string) => {
    const current = armed()
    const operation = dialog()
    if (!current || !operation || busy()) return
    setBusy(true)
    setActionError('')
    try {
      let reveal: string | null = null
      if (operation === 'create-file' || operation === 'create-folder') {
        const parent = !current.target.path && destinationFolder()
          ? await api.entry(taskId, destinationFolder()) : current.target
        reveal = await props.actions.create(parent, suppliedName ?? name(), operation === 'create-file' ? 'file' : 'folder')
      } else if (operation === 'rename') reveal = await props.actions.rename(current, suppliedName ?? name())
      else await props.actions.trash(current, saveDrafts)
      await refresh()
      if (reveal) {
        const segments = reveal.split('/').slice(0, -1)
        let parent = ''
        for (const segment of segments) { parent = parent ? `${parent}/${segment}` : segment; setEditorTreeDirectoryOpen(taskId, parent, true); await load(parent) }
        revealCollectionItem(TREE, reveal)
      }
      finish()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const copyPath = (absolute: boolean) => {
    const target = armed()?.target
    if (!target) return
    void navigator.clipboard.writeText(absolute ? `${target.root}/${target.path}` : target.path)
  }
  const menuItems = (menu: Parameters<Parameters<typeof Menu>[0]['children']>[0]) => {
    const target = armed()?.target
    if (!target) return null
    return <>
      {target.kind === 'folder' && <>
        <Menu.Item context={menu} onSelect={() => begin('create-file')}>New file…</Menu.Item>
        <Menu.Item context={menu} onSelect={() => begin('create-folder')}>New folder…</Menu.Item>
      </>}
      {!!target.path && <Menu.Item context={menu} onSelect={() => begin('rename')}>Rename…</Menu.Item>}
      {!!target.path && <>
        <Menu.Item context={menu} onSelect={() => copyPath(false)}>Copy relative path</Menu.Item>
        <Menu.Item context={menu} onSelect={() => copyPath(true)}>Copy absolute path</Menu.Item>
        <Menu.Separator />
        <Menu.Item context={menu} tone="danger" disabled={!trashSupport().available} title={trashSupport().reason}
          onSelect={() => begin('trash')}>Move to trash…</Menu.Item>
      </>}
    </>
  }
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
      {actionError() && <Alert tone="danger">{actionError()}</Alert>}
      {rootEntry() && <Menu ariaLabel="Worktree actions" open={() => menuPath() === ''}
        onBeforeOpen={() => prepareMenu(rootEntry()!)} onOpenChange={(open) => {
        if (open) openMenu(rootEntry()!)
        else dismissMenu()
      }} trigger={({ toggle }) => <Button onPress={toggle}>New…</Button>}>
        {menuItems}
      </Menu>}
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
      onMenu={(key) => {
        const item = items().find((candidate) => candidate.key === key)
        const target = item && targetOf(item)
        if (target) openMenu(target)
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
          onMenu={() => { const target = targetOf(item); if (target) openMenu(target) }}
          onRename={() => { const target = targetOf(item); if (target) { openMenu(target); begin('rename') } }}
          trailing={<RowActions ariaLabel={`Actions for ${item.key}`} open={() => menuPath() === item.key}
            onBeforeOpen={() => { const target = targetOf(item); if (target) prepareMenu(target) }}
            onOpenChange={(open) => {
              if (open) { const target = targetOf(item); if (target) openMenu(target) }
              else dismissMenu()
            }}>{menuItems}</RowActions>}
          title={item.key}
        >
          {item.label}
          {inlinePath() === item.key && <Input label={dialog() === 'rename' ? 'Rename entry' : 'New name'}
            value={name()} onInput={setName} onSubmit={(value) => void act(false, value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); finish() } }}
            ref={(element) => queueMicrotask(() => {
              if (!element.isConnected) return
              element.focus()
              if (dialog() === 'rename') {
                const value = name()
                const dotfile = value.startsWith('.') && value.indexOf('.', 1) < 0
                const end = dotfile ? value.length : value.lastIndexOf('.') > 0 ? value.lastIndexOf('.') : value.length
                element.setSelectionRange(0, end)
              }
            })} />}
        </TreeRow>
      )}
    </Rows>
    {dialog() && armed() && !inlinePath() && <Modal title={dialog() === 'trash' ? 'Move to trash' : dialog() === 'rename' ? 'Rename entry' : 'Create entry'}
      role={dialog() === 'trash' ? 'alertdialog' : 'dialog'} onDismiss={finish}>
      <Modal.Body>
        {dialog() === 'trash'
          ? <Text wrap>Move {armed()!.target.path} from task {taskId} to this Node’s trash? {armed()!.target.kind === 'folder' ? 'The folder and its descendants are affected.' : ''}</Text>
          : <>
            <Input label="Name" value={name()} onInput={setName} onSubmit={(value) => void act(false, value)} />
            {(dialog() === 'create-file' || dialog() === 'create-folder') && !armed()!.target.path
              && <Input label="Destination folder (relative to root)" value={destinationFolder()} onInput={setDestinationFolder} />}
          </>}
        {actionError() && <Alert tone="danger">{actionError()}</Alert>}
      </Modal.Body>
      <Modal.Actions>
        <Button onPress={finish}>Cancel</Button>
        {dialog() === 'trash' ? <>
          {!armed()!.dirty().length && <Button disabled={busy()} onPress={() => void act()}>Move to trash</Button>}
          {!!armed()!.dirty().length && <Button disabled={busy()} onPress={() => void act(true)}>Save and move to trash</Button>}
        </> : <Button disabled={busy()} onPress={() => void act()}>Confirm</Button>}
      </Modal.Actions>
    </Modal>}
    </Stack>
  )
}
