import { useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import {
  activeNodeId,
  latestSignal,
  prefsOptions,
  queryOwner,
  revealCollectionItem,
  wsOnNodeEvent,
  wsOnReconnect,
} from '@acorn/plugin-api/client'
import {
  Alert,
  Badge,
  Button,
  copyText,
  Field,
  IconButton,
  Input,
  Menu,
  Modal,
  Only,
  RowActions,
  Rows,
  Stack,
  Text,
  Toolbar,
  TreeRow,
} from '@acorn/plugin-api/ui'
import { HOST } from '@acorn/plugin-api/ui/tokens'
import { editorApi, type EditorEntry } from './editorClient'
import type { FileTarget, TrashAvailability } from '../contract/api'
import type { ArmedFileAction } from './fileActionModel'
import { createFileActionModel } from './fileActionModel'
import {
  collapseEditorTreeDirectories,
  editorTreeDirectoryOpen,
  editorTreeCollectionId,
  registerEditorTreeFolders,
  setEditorTreeDirectoryOpen,
} from './editorTreeState'
import { type FileTreeRevealRequest } from './fileTreeReveal'
import { findInFolder, searchScopePathChanged } from './search/searchState'
import { pathContains } from './editorState'
import { readEditorShowIgnored, saveEditorShowIgnored } from './editorPrefs'
import type { FileStatusProjection } from './fileStatusModel'
import { ContributedMenuRows, editorMenuTarget } from './contributedMenuRows'
import { FileMarkGlyphs, fileMarkLegend, fileMarks } from './fileAnnotations'

const badgeTone = (tone: 'muted' | 'ok' | 'accent' | 'danger'): 'neutral' | 'ok' | 'accent' | 'danger' =>
  tone === 'muted' ? 'neutral' : tone

export default function FileTree(props: {
  taskId: string
  projectId: string
  taskTitle: string
  fileStatus: () => FileStatusProjection
  statusStale: () => boolean
  onStatusChanged: () => void
  onOpen: (path: string, ephemeral: boolean) => void
  openPath: string | null
  reveal: FileTreeRevealRequest | null
  onRevealed: (request: FileTreeRevealRequest) => void
  onRevealActive: () => void
  actions: ReturnType<typeof createFileActionModel>
  /** The file rows in expanded folders, for the pane's one annotation batch. Folders are left out. */
  onVisibleFiles: (paths: readonly string[]) => void
}) {
  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const treeId = () => editorTreeCollectionId(props.taskId, nodeId)
  const api = editorApi(queryClient)
  const prefs = createQuery(() => prefsOptions(true))
  const showIgnored = () => readEditorShowIgnored(prefs.data)
  const [ignoreByDir, setIgnoreByDir] = createSignal<
    ReadonlyMap<string, { ignored: ReadonlySet<string>; error?: string }>
  >(new Map())
  const [temporaryReveal, setTemporaryReveal] = createSignal<string | null>(null)
  const [listings, setListings] = createSignal<ReadonlyMap<string, EditorEntry[]>>(new Map())
  const [errors, setErrors] = createSignal<ReadonlyMap<string, string>>(new Map())
  const [rootEntry, setRootEntry] = createSignal<FileTarget | null>(null)
  const [trashSupport, setTrashSupport] = createSignal<TrashAvailability>({
    available: false,
    reason: 'Checking Node trash support…',
  })
  const [renameSupport, setRenameSupport] = createSignal<TrashAvailability>({
    available: false,
    reason: 'Checking Node rename support…',
  })
  const [menuPath, setMenuPath] = createSignal<string | null>(null)
  const [armed, setArmed] = createSignal<ArmedFileAction | null>(null)
  const [dialog, setDialog] = createSignal<'create-file' | 'create-folder' | 'rename' | 'trash' | null>(null)
  const [inlinePath, setInlinePath] = createSignal<string | null>(null)
  const [name, setName] = createSignal('')
  const [destinationFolder, setDestinationFolder] = createSignal('')
  const [actionError, setActionError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  // The tree's listings. A refresh, a task change, collapsing everything, or unmounting aborts them.
  const listing = latestSignal()
  const loading = new Map<string, { listing: AbortSignal; run: Promise<boolean> }>()
  // Each directory's newest Git ignore read.
  const ignoreReads = new Map<string, AbortController>()
  let disposed = false
  let taskId = props.taskId
  const live = (listed: AbortSignal, task: string) =>
    !disposed && !listed.aborted && taskId === task && activeNodeId() === nodeId

  const load = (dir: string, refresh = false): Promise<boolean> => {
    const running = loading.get(dir)
    if (running && !running.listing.aborted) return running.run
    if (!refresh && listings().has(dir)) return Promise.resolve(true)
    const listed = listing.signal
    const task = taskId
    let entry: { listing: AbortSignal; run: Promise<boolean> }
    const run = Promise.resolve()
      .then(() => api.list(task, dir))
      .then((entries) => {
        if (!live(listed, task)) return false
        setErrors((current) => {
          const next = new Map(current)
          next.delete(dir)
          return next
        })
        setListings((current) => new Map(current).set(dir, entries))
        ignoreReads.get(dir)?.abort()
        const read = new AbortController()
        ignoreReads.set(dir, read)
        // A fresh listing has no verified ignore classification yet. Show its entries until Git
        // answers, so a stale hidden set never suppresses names added or changed by this listing.
        setIgnoreByDir((current) => {
          const next = new Map(current)
          next.delete(dir)
          return next
        })
        void Promise.resolve()
          .then(() =>
            api.ignored(
              task,
              dir,
              entries.map((entry) => entry.name),
            ),
          )
          .then((result) => {
            if (!live(listed, task) || read.signal.aborted) return
            setIgnoreByDir((current) =>
              new Map(current).set(
                dir,
                result.available ? { ignored: new Set(result.ignored) } : { ignored: new Set(), error: result.reason },
              ),
            )
          })
          .catch((cause: unknown) => {
            if (live(listed, task) && !read.signal.aborted)
              setIgnoreByDir((current) =>
                new Map(current).set(dir, {
                  ignored: new Set(),
                  error: cause instanceof Error ? cause.message : 'Git ignore rules are unavailable.',
                }),
              )
          })
        return true
      })
      .catch((cause: unknown) => {
        if (live(listed, task)) {
          ignoreReads.get(dir)?.abort()
          ignoreReads.delete(dir)
          setIgnoreByDir((current) =>
            new Map(current).set(dir, {
              ignored: new Set(),
              error: 'Ignore filtering unavailable while the directory listing is stale.',
            }),
          )
          setErrors((current) =>
            new Map(current).set(dir, cause instanceof Error ? cause.message : 'Unable to read directory.'),
          )
        }
        return false
      })
      .finally(() => {
        if (loading.get(dir) === entry) loading.delete(dir)
      })
    entry = { listing: listed, run }
    loading.set(dir, entry)
    return run
  }

  // No path is carried by the worktree event. Refresh loaded directories in parent order;
  // unopened directories stay lazy, and previous successful listings survive failed reads.
  const refresh = async () => {
    const listed = listing.next()
    const task = taskId
    void api
      .entry(task, '')
      .then((entry) => {
        if (live(listed, task)) setRootEntry(entry)
      })
      .catch(() => {})
    const dirs = [...new Set(['', ...listings().keys(), ...loading.keys(), ...errors().keys()])].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    )
    for (const dir of dirs) {
      if (!live(listed, task)) return
      if (dir) {
        const split = dir.lastIndexOf('/')
        const parent = split < 0 ? '' : dir.slice(0, split)
        const name = dir.slice(split + 1)
        if (
          !listings()
            .get(parent)
            ?.some((entry) => entry.dir && entry.name === name)
        ) {
          setListings((current) => {
            const next = new Map(current)
            next.delete(dir)
            return next
          })
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
    listing.next()
    loading.clear()
    ignoreReads.clear()
    setErrors(new Map())
    setListings(new Map())
    setIgnoreByDir(new Map())
    setTemporaryReveal(null)
    setRootEntry(null)
    void load('')
    void api
      .entry(next, '')
      .then((entry) => {
        if (taskId === next) setRootEntry(entry)
      })
      .catch(() => {})
  })
  onMount(() => {
    void load('')
    void api
      .entry(taskId, '')
      .then(setRootEntry)
      .catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)))
    void api
      .trashAvailability(taskId)
      .then(setTrashSupport)
      .catch((cause: unknown) =>
        setTrashSupport({ available: false, reason: cause instanceof Error ? cause.message : String(cause) }),
      )
    void api
      .renameAvailability(taskId)
      .then(setRenameSupport)
      .catch((cause: unknown) =>
        setRenameSupport({ available: false, reason: cause instanceof Error ? cause.message : String(cause) }),
      )
    const offWorktree = wsOnNodeEvent('worktree:status-changed', (event) => {
      if (event.taskId === taskId && activeNodeId() === nodeId) void refresh()
    })
    const offReconnect = wsOnReconnect(() => {
      if (activeNodeId() === nodeId) void refresh()
    })
    const focus = () => {
      if (activeNodeId() === nodeId) void refresh()
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
      window.addEventListener('focus', focus)
    onCleanup(() => {
      disposed = true
      release()
      listing.abort()
      ignoreReads.clear()
      offWorktree()
      offReconnect()
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function')
        window.removeEventListener('focus', focus)
    })
  })

  const isOpen = (path: string) => editorTreeDirectoryOpen(props.taskId, path, nodeId)
  createEffect(
    on(
      () => props.openPath,
      (path) => {
        if (temporaryReveal() && temporaryReveal() !== path) setTemporaryReveal(null)
      },
    ),
  )

  const targetOf = (item: TreeItem): FileTarget | null => {
    const entry = listings()
      .get(item.key.includes('/') ? item.key.slice(0, item.key.lastIndexOf('/')) : '')
      ?.find((candidate) => candidate.name === item.label)
    return entry?.identity && entry.entryId && entry.kind && entry.root
      ? { path: item.key, kind: entry.kind, identity: entry.identity, entryId: entry.entryId, root: entry.root }
      : null
  }
  const release = () => {
    armed()?.release()
    setArmed(null)
    setMenuPath(null)
  }
  const restoreFocus = (path: string) =>
    queueMicrotask(() => {
      const rows = items()
      const surviving = rows.some((item) => item.key === path) ? path : rows[0]?.key
      if (surviving && !disposed) revealCollectionItem(treeId(), surviving)
    })
  const dismissMenu = () => {
    const closing = armed()
    queueMicrotask(() => {
      if (!busy() && !dialog() && armed() === closing) {
        const path = closing?.target.path
        release()
        if (path !== undefined) restoreFocus(path)
      }
    })
  }
  const prepareMenu = (target: FileTarget) => {
    if (armed()?.target.path === target.path) return
    release()
    try {
      setArmed(props.actions.arm(target))
      setActionError('')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const openMenu = (target: FileTarget) => {
    prepareMenu(target)
    if (armed()) setMenuPath(target.path)
  }
  const begin = (next: 'create-file' | 'create-folder' | 'rename' | 'trash') => {
    const target = armed()?.target
    if (!target) return
    if (next === 'rename' && !renameSupport().available) {
      setActionError(renameSupport().reason ?? 'Rename is unavailable on this Node.')
      return
    }
    setName(next === 'rename' ? (target.path.split('/').pop() ?? '') : '')
    setDestinationFolder('')
    setActionError('')
    setDialog(next)
    setInlinePath(
      HOST === 'dom' && next !== 'trash' && target.path && items().some((item) => item.key === target.path)
        ? target.path
        : null,
    )
    setMenuPath(null)
  }
  const closeAction = (focusPath?: string) => {
    if (busy()) return
    setDialog(null)
    setInlinePath(null)
    release()
    if (focusPath !== undefined) restoreFocus(focusPath)
  }
  const finish = () => closeAction(armed()?.target.path)
  const act = async (saveDrafts = false, suppliedName?: string) => {
    const current = armed()
    const operation = dialog()
    if (!current || !operation || busy()) return
    const operationTask = taskId
    const actions = props.actions
    const endOperation = current.hold()
    setBusy(true)
    setActionError('')
    try {
      let reveal: string | null = null
      if (operation === 'create-file' || operation === 'create-folder') {
        const parent =
          !current.target.path && destinationFolder()
            ? await api.entry(operationTask, destinationFolder())
            : current.target
        reveal = await actions.create(parent, suppliedName ?? name(), operation === 'create-file' ? 'file' : 'folder')
      } else if (operation === 'rename') reveal = await actions.rename(current, suppliedName ?? name())
      else await actions.trash(current, saveDrafts)
      if (disposed || taskId !== operationTask || activeNodeId() !== nodeId) return
      if (operation === 'rename' || operation === 'trash') searchScopePathChanged(taskId, current.target.path, nodeId)
      await refresh()
      props.onStatusChanged()
      if (reveal) {
        setTemporaryReveal(reveal)
        const segments = reveal.split('/').slice(0, -1)
        let parent = ''
        for (const segment of segments) {
          parent = parent ? `${parent}/${segment}` : segment
          setEditorTreeDirectoryOpen(operationTask, parent, true, nodeId)
          await load(parent)
        }
        revealCollectionItem(treeId(), reveal)
      }
      setBusy(false)
      closeAction(reveal ?? current.target.path)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      endOperation()
      setBusy(false)
    }
  }
  const copyPath = (absolute: boolean) => {
    const target = armed()?.target
    if (!target) return
    const value = absolute ? `${target.root}/${target.path}` : target.path
    void copyText(value).then((copied) => {
      if (!copied) setActionError(`Copy this path manually: ${value}`)
    })
  }
  const menuItems = (menu: Parameters<Parameters<typeof Menu>[0]['children']>[0]) => {
    const target = armed()?.target
    if (!target) return null
    return (
      <>
        {target.kind === 'folder' && (
          <>
            <Menu.Item context={menu} onSelect={() => findInFolder(taskId, target.path, nodeId)}>
              Find in folder
            </Menu.Item>
            <Menu.Item context={menu} onSelect={() => begin('create-file')}>
              New file…
            </Menu.Item>
            <Menu.Item context={menu} onSelect={() => begin('create-folder')}>
              New folder…
            </Menu.Item>
          </>
        )}
        {!!target.path && (
          <Menu.Item
            context={menu}
            disabled={!renameSupport().available}
            title={renameSupport().reason}
            onSelect={() => begin('rename')}
          >
            Rename…
          </Menu.Item>
        )}
        {!!target.path && (
          <>
            <Menu.Item context={menu} onSelect={() => copyPath(false)}>
              Copy relative path
            </Menu.Item>
            <Menu.Item context={menu} onSelect={() => copyPath(true)}>
              Copy absolute path
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              context={menu}
              tone="danger"
              disabled={!trashSupport().available}
              title={trashSupport().reason}
              onSelect={() => begin('trash')}
            >
              Move to trash…
            </Menu.Item>
            <ContributedMenuRows
              context={menu}
              guard={(run) => runContributed(target, run)}
              target={editorMenuTarget('file.row', {
                nodeId,
                taskId,
                projectId: props.projectId,
                path: target.path,
                directory: target.kind === 'folder',
              })}
            />
          </>
        )}
      </>
    )
  }
  // Another plugin's row runs only while the menu still holds the entry it opened on, and only while
  // that entry is still a visible row: a trash, rename or refresh that removed it ends the action.
  const runContributed = (target: FileTarget, run: () => void) => {
    if (
      armed()?.target !== target ||
      !items().some((item) => item.key === target.path) ||
      !live(listing.signal, taskId)
    )
      return
    run()
  }
  const setOpen = (path: string, open: boolean) => {
    setEditorTreeDirectoryOpen(props.taskId, path, open, nodeId)
    if (open) void load(path)
  }
  const collapseAll = () => {
    listing.next()
    loading.clear()
    ignoreReads.clear()
    collapseEditorTreeDirectories(taskId, nodeId)
    setListings((current) => new Map([['', current.get('') ?? []]]))
    setIgnoreByDir((current) => new Map(current.has('') ? [['', current.get('')!]] : []))
    setErrors(new Map())
    setTemporaryReveal(null)
  }

  // The visible rows, flat. A tree is a flat collection with a depth on each row, which is what lets
  // the host own arrow keys, type-ahead, `aria-activedescendant` and the roving stop: the recursive
  // component this replaced had a `<ul>` per directory and no keyboard at all.
  type TreeItem = { key: string; label: string; depth: number; dir: boolean }
  let previousItems = new Map<string, TreeItem>()
  const items = createMemo<TreeItem[]>(() => {
    const rows: TreeItem[] = []
    const nextItems = new Map<string, TreeItem>()
    const walk = (dir: string, depth: number): void => {
      for (const entry of listings().get(dir) ?? []) {
        const path = dir ? `${dir}/${entry.name}` : entry.name
        if (
          !showIgnored() &&
          ignoreByDir().get(dir)?.ignored.has(entry.name) &&
          !pathContains(path, temporaryReveal() ?? '')
        )
          continue
        const previous = previousItems.get(path)
        const item =
          previous?.label === entry.name && previous.depth === depth && previous.dir === entry.dir
            ? previous
            : { key: path, label: entry.name, depth, dir: entry.dir }
        rows.push(item)
        nextItems.set(path, item)
        if (entry.dir && isOpen(path)) walk(path, depth + 1)
      }
    }
    walk('', 0)
    previousItems = nextItems
    return rows
  })

  // Collapsing a folder drops its files from the batch. Virtual scrolling doesn't: the shared host
  // clears a contributor's marks whenever the key set changes, so asking per scrolled row would blank
  // every mark on each scroll step.
  createEffect(() => props.onVisibleFiles(items().flatMap((item) => (item.dir ? [] : [item.key]))))
  onCleanup(() => props.onVisibleFiles([]))

  createEffect(
    on(
      () => props.taskId,
      (task) => {
        onCleanup(
          registerEditorTreeFolders(task, nodeId, (path) => items().some((item) => item.key === path && item.dir)),
        )
      },
    ),
  )

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
  createEffect(
    on(
      () => [props.taskId, props.reveal] as const,
      ([, request]) => {
        if (!request) return
        const task = taskId
        const listed = listing.signal
        const current = () => live(listed, task) && props.reveal === request
        if (!current()) return
        setTemporaryReveal(request.path)
        void (async () => {
          if (!(await load('')) || !current()) return
          const segments = request.path.split('/').slice(0, -1)
          let dir = ''
          for (const segment of segments) {
            if (!current()) return
            dir = dir ? `${dir}/${segment}` : segment
            setEditorTreeDirectoryOpen(task, dir, true, nodeId)
            if (!(await load(dir)) || !current()) return
          }
          if (!current()) return
          revealCollectionItem(treeId(), request.path)
          props.onRevealed(request)
        })()
      },
    ),
  )

  return (
    <Stack grow>
      <Toolbar size="sm" ariaLabel="Tree controls">
        <IconButton icon="fold-vertical" label="Collapse all folders" onPress={collapseAll} />
        <IconButton
          icon="locate-fixed"
          label="Reveal active file"
          disabled={!props.openPath}
          onPress={props.onRevealActive}
        />
        <IconButton
          icon="eye"
          label="Show ignored files"
          tipSub=".git and node_modules remain excluded."
          pressed={showIgnored()}
          onPress={() => {
            void saveEditorShowIgnored(queryClient, !showIgnored())
          }}
        />
        {rootEntry() && (HOST !== 'tui' || (!dialog() && (menuPath() === null || menuPath() === ''))) && (
          <Menu
            ariaLabel="Worktree actions"
            open={() => menuPath() === ''}
            onBeforeOpen={() => prepareMenu(rootEntry()!)}
            onOpenChange={(open) => {
              if (open) openMenu(rootEntry()!)
              else dismissMenu()
            }}
            trigger={({ toggle }) => <IconButton icon="plus" label="New file or folder" onPress={toggle} />}
          >
            {menuItems}
          </Menu>
        )}
      </Toolbar>
      {actionError() && <Alert tone="danger">{actionError()}</Alert>}
      {props.statusStale() && <Alert tone="warn">Git status may be stale. Files remain available.</Alert>}
      {Array.from(ignoreByDir())
        .filter(([, info]) => info.error)
        .map(([dir, info]) => (
          <Alert tone="warn">
            Ignore filtering unavailable for {dir || 'worktree'}: {info.error}. All entries remain visible.
          </Alert>
        ))}
      <Only hosts={['tui']}>
        {menuPath() && !dialog() && (
          <Menu
            ariaLabel="Entry actions"
            open={() => !!menuPath() && !dialog()}
            onOpenChange={(open) => {
              if (!open) dismissMenu()
            }}
            trigger={() => <Text>Actions for {menuPath()}</Text>}
          >
            {menuItems}
          </Menu>
        )}
      </Only>
      {Array.from(errors()).map(([dir, message]) => (
        <Alert tone="danger">
          {dir || 'Worktree'}: {message} <Button onPress={() => void load(dir, true)}>Retry</Button>
        </Alert>
      ))}
      {dialog() && armed() && !inlinePath() && (
        <Modal
          title={
            dialog() === 'trash'
              ? 'Move to trash'
              : dialog() === 'rename'
                ? 'Rename entry'
                : dialog() === 'create-folder'
                  ? 'Create folder'
                  : 'Create file'
          }
          role={dialog() === 'trash' ? 'alertdialog' : 'dialog'}
          onDismiss={finish}
        >
          <Modal.Body>
            {dialog() === 'trash' ? (
              <Text wrap>
                Move {armed()!.target.path} from task “{props.taskTitle}” to this Node’s trash?{' '}
                {armed()!.target.kind === 'folder' ? 'The folder and its descendants are affected.' : ''}
              </Text>
            ) : (
              <Stack gap="stack">
                <Text wrap>
                  {dialog() === 'rename' ? 'Rename' : 'Create in'} {armed()!.target.path || 'the task root'}.
                </Text>
                <Field
                  label={
                    dialog() === 'create-file' ? 'File name' : dialog() === 'create-folder' ? 'Folder name' : 'Name'
                  }
                  hint="Enter a name without folder separators."
                >
                  <Input
                    autofocus
                    placeholder={dialog() === 'create-folder' ? 'e.g. components' : 'e.g. notes.md'}
                    value={name()}
                    onInput={setName}
                    onSubmit={(value) => void act(false, value)}
                  />
                </Field>
                {(dialog() === 'create-file' || dialog() === 'create-folder') && !armed()!.target.path && (
                  <Field
                    label="Destination folder (optional)"
                    hint="Relative to the task root. Leave blank to create in the root. The folder must already exist."
                  >
                    <Input
                      placeholder="e.g. src/components"
                      value={destinationFolder()}
                      onInput={setDestinationFolder}
                    />
                  </Field>
                )}
              </Stack>
            )}
            {actionError() && <Alert tone="danger">{actionError()}</Alert>}
          </Modal.Body>
          <Modal.Actions>
            <Button disabled={busy()} onPress={finish}>
              Cancel
            </Button>
            {dialog() === 'trash' ? (
              <>
                {!armed()!.dirty().length && (
                  <Button disabled={busy()} onPress={() => void act()}>
                    Move to trash
                  </Button>
                )}
                {!!armed()!.dirty().length && (
                  <Button disabled={busy()} onPress={() => void act(true)}>
                    Save and move to trash
                  </Button>
                )}
              </>
            ) : (
              <Button variant="solid" disabled={busy() || !name().trim()} onPress={() => void act()}>
                {dialog() === 'rename' ? 'Rename' : dialog() === 'create-folder' ? 'Create folder' : 'Create file'}
              </Button>
            )}
          </Modal.Actions>
        </Modal>
      )}
      {(HOST !== 'tui' || (!dialog() && menuPath() === null)) && (
        <Show when={treeId()} keyed>
          {(id) => (
            <Rows
              virtual
              id={id}
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
              {(item, itemProps, selected, place) => {
                const folderMark = () => (item.dir ? props.fileStatus().folders.get(item.key) : undefined)
                const fileMark = () => (item.dir ? undefined : props.fileStatus().files.get(item.key))
                const marks = () => (item.dir ? [] : fileMarks(props.taskId, item.key))
                const statusLabel = () =>
                  [folderMark()?.label ?? fileMark()?.label, fileMarkLegend(marks())].filter(Boolean).join('; ')
                const parent = item.key.includes('/') ? item.key.slice(0, item.key.lastIndexOf('/')) : ''
                const ignored = () => ignoreByDir().get(parent)?.ignored.has(item.label) ?? false
                return (
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
                    onMenu={() => {
                      const target = targetOf(item)
                      if (target) openMenu(target)
                    }}
                    onBeforeMenu={() => {
                      const target = targetOf(item)
                      if (target) prepareMenu(target)
                    }}
                    onRename={() => {
                      const target = targetOf(item)
                      if (target) {
                        prepareMenu(target)
                        begin('rename')
                      }
                    }}
                    onCreate={() => {
                      const root = rootEntry()
                      if (root) openMenu(root)
                    }}
                    trailing={
                      <>
                        <Only hosts={['dom']}>
                          <RowActions
                            ariaLabel={`Actions for ${item.key}`}
                            open={() => menuPath() === item.key}
                            onBeforeOpen={() => {
                              const target = targetOf(item)
                              if (target) prepareMenu(target)
                            }}
                            onOpenChange={(open) => {
                              if (open) {
                                const target = targetOf(item)
                                if (target) openMenu(target)
                              } else dismissMenu()
                            }}
                          >
                            {menuItems}
                          </RowActions>
                        </Only>
                        <Only hosts={['tui']}>
                          <Button
                            onPress={() => {
                              const target = targetOf(item)
                              if (target) openMenu(target)
                            }}
                          >
                            Actions
                          </Button>
                        </Only>
                      </>
                    }
                    title={`${item.key}${ignored() ? ' — ignored by Git' : ''}${statusLabel() ? ` — ${statusLabel()}` : ''}`}
                    label={`${item.key}${ignored() ? ', ignored by Git' : ''}${statusLabel() ? `, ${statusLabel()}` : ''}`}
                    meta={
                      item.dir ? (
                        folderMark() && (
                          <>
                            <Badge
                              size="xs"
                              tone={folderMark()!.tone === 'danger' ? 'danger' : 'neutral'}
                              tip={folderMark()!.label}
                            >
                              {folderMark()!.count}
                            </Badge>
                            <Only hosts={['tui']}>
                              <Text emphasis="muted">{` ${folderMark()!.label}`}</Text>
                            </Only>
                          </>
                        )
                      ) : (
                        <>
                          {fileMark() && (
                            <>
                              <Badge size="xs" tone={badgeTone(fileMark()!.tone)} tip={fileMark()!.label}>
                                {fileMark()!.letter}
                              </Badge>
                              <Only hosts={['tui']}>
                                <Text emphasis="muted">{` ${fileMark()!.label}`}</Text>
                              </Only>
                            </>
                          )}
                          <FileMarkGlyphs marks={marks()} />
                          {marks().length > 0 && (
                            <Only hosts={['tui']}>
                              <Text emphasis="muted">{` ${fileMarkLegend(marks())}`}</Text>
                            </Only>
                          )}
                        </>
                      )
                    }
                  >
                    <Text tone={folderMark()?.tone ?? fileMark()?.tone} emphasis={ignored() ? 'muted' : undefined}>
                      {item.label}
                    </Text>
                    {inlinePath() === item.key && (
                      <Input
                        label={dialog() === 'rename' ? 'Rename entry' : 'New name'}
                        value={name()}
                        onInput={setName}
                        onSubmit={(value) => void act(false, value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            finish()
                          }
                        }}
                        ref={(element) =>
                          queueMicrotask(() => {
                            if (!element.isConnected) return
                            element.focus()
                            if (dialog() === 'rename') {
                              const value = name()
                              const dotfile = value.startsWith('.') && value.indexOf('.', 1) < 0
                              const end = dotfile
                                ? value.length
                                : value.lastIndexOf('.') > 0
                                  ? value.lastIndexOf('.')
                                  : value.length
                              element.setSelectionRange(0, end)
                            }
                          })
                        }
                      />
                    )}
                  </TreeRow>
                )
              }}
            </Rows>
          )}
        </Show>
      )}
    </Stack>
  )
}
