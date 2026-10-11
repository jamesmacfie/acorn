import { createEffect, createMemo, createSignal, lazy, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { languageIdForPath } from '@acorn/protocol/languageIds.ts'
import {
  activeTaskId,
  clientEvents,
  consumePaneIntent,
  focusedPane,
  onClosePaneWhen,
  type PaneIntent,
  prefsOptions,
  registerCommands,
  toast,
  type Task,
} from '@acorn/plugin-api/client'
import {
  Alert,
  Button,
  ConfirmButton,
  copyText,
  DetailColumn,
  DocumentTabs,
  EmptyState,
  Icon,
  IconButton,
  Input,
  ListDetail,
  Menu,
  Only,
  paneCollapseKey,
  Rectangle,
  sidebarCollapse,
  TabPanel,
  Tabs,
  ToggleButton,
} from '@acorn/plugin-api/ui'
import { SelectionActions, Slot } from '@acorn/plugin-api/ui/host'
import { EDITOR_DOCUMENT_POINT } from '@acorn/protocol/extensionPoints.ts'
import { editorApi } from './editorClient'
import { createEditorController } from './editorController'
import { saveEditorMode } from './editorPrefs'
import { editorPromote } from './editorState'
import FileTree from './FileTree'
import { fileMarkLegend, fileMarks, requestFileAnnotations, tabMarks } from './fileAnnotations'
import { canRevealActiveFile, type FileTreeRevealRequest } from './fileTreeReveal'
import SearchPanel from './search/SearchPanel'
import { tabLabels } from './tabLabels'
import EditorStatus from './EditorStatus'
import { EDITOR_ACTIONS } from './editorActions'
import { languageName } from './editorPresentation'
import { ContributedMenuRows, editorMenuTarget } from './contributedMenuRows'
import FileDiagnostics from './FileDiagnostics'

// Only ever mounted in terminal mode, and it drags xterm in with it.
const EditorTerminal = lazy(() => import('./EditorTerminal'))
const ImagePreview = lazy(() => import('./ImagePreview'))
const EditorComparison = lazy(() => import('./EditorComparison'))

// The extension-to-language map and the editor theme live in the host (docs/editor.md § The shared surface).

// The editor pane: a lazy file tree on the left, a file tab bar and one reused CodeMirror instance
// on the right. Single-click opens an ephemeral (italic) preview tab; editing or double-click
// promotes it. Cmd+S saves; a dirty dot marks the tab; reload-on-focus with a dirty guard, since the
// agent and the human share the worktree.
//
// A reader who lives in vim can have the same box hold `$EDITOR` in a throwaway PTY instead
// (docs/editor/editor-pane.md § Editing in your own editor). One device preference switches it, graphical is the
// default, and everything to the left of the box is untouched either way.
//
// This component draws the pane and wires it up. The controller in editorController.ts owns the
// CodeMirror view, the pooled documents, disk reads, saves, and navigation.
export default function EditorPane(props: { task: Task }) {
  const taskId = props.task.id
  const queryClient = useQueryClient()
  const api = editorApi(queryClient)
  const prefs = createQuery(() => prefsOptions(true))
  const editor = createEditorController({ task: props.task, api, queryClient, prefs: () => prefs.data })
  const { nodeId, fileStatus, files, active, mode, imagePath, ptyPath, renderedPath, rendered, occupied } = editor

  const [side, setSide] = createSignal<'files' | 'search'>('files')
  const [treeReveal, setTreeReveal] = createSignal<FileTreeRevealRequest | null>(null)
  const sidebarKey = paneCollapseKey('editor')
  const [, setSidebarCollapsed] = sidebarCollapse(sidebarKey)

  const activeTab = () => files().find((file) => file.path === active())
  // Keep tab definitions stable when only the active path changes. DocumentTabs reconciles by tab
  // object identity, so rebuilding every definition here would replace the focused tab on each
  // keyboard move even though the open files themselves had not changed.
  const documentTabs = createMemo(() => {
    const labels = tabLabels(files().map((file) => file.path))
    return files().map((file) => {
      const status = fileStatus.projection().files.get(file.path)
      const marks = fileMarks(taskId, file.path)
      return {
        id: file.path,
        label: labels.get(file.path) ?? file.path,
        title: [
          file.path,
          status && `${status.label}${fileStatus.stale() ? ' (Git status may be stale)' : ''}`,
          marks.length > 0 && fileMarkLegend(marks),
        ]
          .filter(Boolean)
          .join(' — '),
        fileStatus: status,
        marks: tabMarks(marks),
        dirty: file.dirty,
        ephemeral: file.ephemeral,
      }
    })
  })
  // Other plugins' marks: one batch for the tree's expanded files and the open tabs together. Keys
  // are paths only, so typing in a tab or switching its preview never re-asks.
  const [treeFiles, setTreeFiles] = createSignal<readonly string[]>([])
  createEffect(() => requestFileAnnotations(taskId, [...files().map((file) => file.path), ...treeFiles()]))

  // Cmd/Ctrl+W closes the active file tab when this pane is the focused one. The pane draws no
  // element of its own to test containment against, so it asks the host which pane has focus.
  onClosePaneWhen(
    () => focusedPane(taskId) === 'editor',
    () => {
      const p = active()
      if (p) void editor.close(p)
    },
  )

  // The tree is one of two things the sidebar shows; revealing into a hidden one is a no-op.
  const revealInTree = (path: string) => {
    setSidebarCollapsed(false)
    setSide('files')
    setTreeReveal({ path })
  }
  const revealActiveFile = () => {
    const path = active()
    if (path) revealInTree(path)
  }

  // A path is relative to the checkout, and the root is the checkout's absolute path.
  const copyFilePath = (path: string, absolute: boolean) => {
    const checkout = editor.root()
    const text = absolute && checkout ? `${checkout}/${path}` : path
    void copyText(text).then((copied) => toast(copied ? `Copied ${text}` : text))
  }
  const copyPath = (absolute: boolean) => {
    const path = active()
    if (path && editor.root()) copyFilePath(path, absolute)
  }

  onMount(() => {
    // All three need the same thing: this task on screen, the editor focused, a file open, and a
    // checkout mapped.
    const when = () =>
      canRevealActiveFile({
        paneTaskId: taskId,
        activeTaskId: activeTaskId(),
        focusedPane: focusedPane(taskId),
        activeFile: active(),
        treeAvailable: !!editor.root(),
      })
    const editorFocused = () => focusedPane(taskId) === 'editor'
    const commands = registerCommands([
      {
        id: 'editor.tree.reveal-active-file',
        title: 'Reveal active file in editor tree',
        category: 'navigation',
        hint: () => active() ?? undefined,
        palette: true,
        when,
        run: revealActiveFile,
      },
      {
        id: 'editor.copy-relative-path',
        title: 'Copy relative path of active file',
        category: 'action',
        hint: () => active() ?? undefined,
        palette: true,
        when,
        run: () => copyPath(false),
      },
      {
        id: 'editor.copy-absolute-path',
        title: 'Copy absolute path of active file',
        category: 'action',
        hint: () => active() ?? undefined,
        palette: true,
        when,
        run: () => copyPath(true),
      },
      {
        id: 'editor.tabs.reopen-closed',
        title: 'Reopen closed file',
        category: 'navigation',
        palette: true,
        when: () => activeTaskId() === taskId && editorFocused(),
        run: () => {
          void editor.reopen()
        },
      },
      {
        id: 'editor.navigation.back',
        title: 'Go back in editor',
        category: 'navigation',
        palette: true,
        when: () => activeTaskId() === taskId && editorFocused(),
        run: () => {
          void editor.replay(-1)
        },
      },
      {
        id: 'editor.navigation.forward',
        title: 'Go forward in editor',
        category: 'navigation',
        palette: true,
        when: () => activeTaskId() === taskId && editorFocused(),
        run: () => {
          void editor.replay(1)
        },
      },
      {
        id: 'editor.toggle-word-wrap',
        title: 'Toggle word wrap',
        category: 'action',
        palette: true,
        when: () => editorFocused() && !!editor.graphicalView(),
        run: editor.toggleWrap,
      },
      ...EDITOR_ACTIONS.map((action) => ({
        id: `editor.edit.${action.id}`,
        title: action.title,
        category: 'action' as const,
        palette: true,
        when: () => editorFocused() && editor.canRunAction(action.id),
        run: () => editor.runAction(action.id),
      })),
    ])
    onCleanup(() => commands.dispose())
  })

  const applyPaneIntent = (intent: PaneIntent | undefined) => {
    if (!intent) return
    // ⌘⇧F and the "Find in files…" palette row.
    if (intent.kind === 'editor:search') {
      setSidebarCollapsed(false)
      setSide('search')
      return
    }
    if (intent.kind === 'editor:tree-reveal') {
      if (active() === intent.path) revealInTree(intent.path)
      return
    }
    if (intent.kind === 'editor:reveal') editor.reveal({ path: intent.path, line: intent.line, column: intent.column })
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId: targetTaskId, paneId, intent }) => {
      if (targetTaskId === taskId && paneId === 'editor') applyPaneIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyPaneIntent(consumePaneIntent(taskId, 'editor')))

  const tabMenu = (path: string, control?: { open: () => boolean; onOpenChange: (open: boolean) => void }) => {
    const owner = {}
    onCleanup(() => editor.releaseTabMenu(path, owner))
    if (control) {
      createEffect(() => {
        if (control.open()) editor.prepareTabMenu(path, owner)
      })
    }
    const onTab = (action: (identity: object | undefined) => void) => () => editor.withTabTarget(path, action)
    const closeSome = (pick: (paths: string[]) => string[]) =>
      onTab(() => {
        void editor.closeMany(pick(files().map((file) => file.path)))
      })
    return (
      <Menu
        ariaLabel={`Actions for ${path}`}
        maxVisibleRows={9}
        open={control?.open}
        onBeforeOpen={() => editor.prepareTabMenu(path, owner)}
        onOpenChange={(open) => {
          control?.onOpenChange(open)
          if (open) editor.prepareTabMenu(path, owner)
          else editor.releaseTabMenu(path, owner)
        }}
        trigger={({ toggle }) => <IconButton icon="ellipsis" label={`Actions for ${path}`} onPress={toggle} />}
      >
        {(menu) => (
          <>
            <Show when={files().find((file) => file.path === path)?.ephemeral}>
              <Menu.Item context={menu} onSelect={onTab(() => editorPromote(taskId, path))}>
                Keep open
              </Menu.Item>
            </Show>
            <Menu.Item
              context={menu}
              onSelect={onTab((identity) => {
                void editor.close(path, { identity })
              })}
            >
              Close
            </Menu.Item>
            <Menu.Item context={menu} onSelect={closeSome((paths) => paths.filter((other) => other !== path))}>
              Close others
            </Menu.Item>
            <Menu.Item context={menu} onSelect={closeSome((paths) => paths.slice(paths.indexOf(path) + 1))}>
              Close to the right
            </Menu.Item>
            <Menu.Item context={menu} onSelect={closeSome((paths) => paths)}>
              Close all
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item context={menu} onSelect={onTab(() => copyFilePath(path, false))}>
              Copy relative path
            </Menu.Item>
            <Menu.Item context={menu} onSelect={onTab(() => copyFilePath(path, true))}>
              Copy absolute path
            </Menu.Item>
            <Menu.Item context={menu} onSelect={onTab(() => revealInTree(path))}>
              Reveal in file tree
            </Menu.Item>
            <ContributedMenuRows
              context={menu}
              guard={(run) => editor.withTabTarget(path, run)}
              target={editorMenuTarget('document.tab', {
                nodeId,
                taskId,
                projectId: props.task.projectId,
                path,
                directory: false,
                revision: editor.savedRevision(path),
              })}
            />
          </>
        )}
      </Menu>
    )
  }

  // The pane's own view of a file, drawn whenever no contributor stands in for it.
  const fileView = () => (
    <Show
      when={imagePath()}
      fallback={
        <>
          <SelectionActions select={editor.selectionTarget} isCurrent={editor.selectionIsCurrent}>
            <Rectangle kind="editor" label="Editor" mount={editor.mountEditor} />
          </SelectionActions>
          <Only hosts={['tui']}>
            <Show when={active()} keyed>
              {(path) => (
                <FileDiagnostics
                  nodeId={nodeId ?? ''}
                  route={() => editor.servicesFor(path).diagnostics}
                  read={async () => (await api.read(taskId, path)).text}
                />
              )}
            </Show>
          </Only>
        </>
      }
      keyed
    >
      {(path) => (
        <>
          <Only hosts={['dom']}>
            <ImagePreview taskId={taskId} path={path} />
          </Only>
          <Only hosts={['tui']}>
            <EmptyState>Image preview is available in the desktop editor: {path}</EmptyState>
          </Only>
        </>
      )}
    </Show>
  )

  const reloadActive = () => {
    const path = active()
    if (path) void editor.revalidate(path)
  }

  return (
    <Show when={editor.root() !== undefined} fallback={<EmptyState busy>Loading…</EmptyState>}>
      <Show
        when={editor.root()}
        fallback={
          <EmptyState title="Can't find this task's files">Open a terminal in this task, then try again.</EmptyState>
        }
      >
        <ListDetail
          listLabel="Editor sidebar"
          collapseKey={sidebarKey}
          collapseContent="empty"
          list={
            <>
              <Tabs
                level="pane"
                tabs={[
                  { id: 'files', label: 'Files' },
                  { id: 'search', label: 'Search' },
                ]}
                active={side()}
                onChange={(id) => setSide(id === 'search' ? 'search' : 'files')}
                idPrefix="editor-side"
                ariaLabel="Editor sidebar"
              />
              {/* Both stay mounted; the hidden one keeps its scroll, its open folders and its results.
                  `TabPanel` owns the hidden-but-mounted half, which this pane used to spell as an
                  inline `display: none` beside six hand-written tab attributes. */}
              <TabPanel idPrefix="editor-side" id="files" active={side()}>
                <FileTree
                  taskId={taskId}
                  projectId={props.task.projectId}
                  taskTitle={props.task.title}
                  fileStatus={fileStatus.projection}
                  statusStale={fileStatus.stale}
                  onStatusChanged={fileStatus.refresh}
                  actions={editor.fileActions}
                  onOpen={editor.openPath}
                  onVisibleFiles={setTreeFiles}
                  openPath={active()}
                  reveal={treeReveal()}
                  onRevealed={(done) => setTreeReveal((request) => (request === done ? null : request))}
                  onRevealActive={() => {
                    const path = active()
                    if (path) setTreeReveal({ path })
                  }}
                />
              </TabPanel>
              <SearchPanel taskId={taskId} active={side() === 'search'} />
            </>
          }
        >
          {/* Was a hand-rolled strip: the dirty state was a string-concatenated ●, the close
              button was mouse-only, and there were no arrow keys. */}
          <DocumentTabs
            level="pane"
            idPrefix="editor"
            ariaLabel="Open files"
            active={active() ?? ''}
            onActivate={editor.activatePath}
            onClose={(path) => void editor.close(path)}
            onPromote={(path) => editorPromote(taskId, path)}
            menu={tabMenu}
            tabs={documentTabs()}
            actions={
              <>
                {/* Two glyphs rather than two words, which read as one phrase: a mode switch, and a
                    send. */}
                <ToggleButton
                  iconOnly
                  variant="bare"
                  size="sm"
                  label="Edit in your terminal editor"
                  tip="Edit in your terminal editor"
                  tipSub="Uses $EDITOR"
                  pressed={mode() === 'terminal'}
                  onPressedChange={(pressed) => void saveEditorMode(queryClient, pressed ? 'terminal' : 'graphical')}
                >
                  <Icon name="square-terminal" />
                </ToggleButton>
                {/* Outside the slot, so a contributor can never take the way back to the text. */}
                <Show when={renderedPath() ? occupied() : editor.rendererOffered()}>
                  <ToggleButton
                    iconOnly
                    variant="bare"
                    size="sm"
                    label="Preview"
                    tip="Preview"
                    tipSub="Drawn by a plugin. Turn off to edit the source."
                    pressed={!!renderedPath()}
                    onPressedChange={(pressed) => editor.showSource(!pressed)}
                  >
                    <Icon name="eye" />
                  </ToggleButton>
                </Show>
                <Show when={active() && !imagePath() && !editor.documentRendered()}>
                  <Show
                    when={activeTab()?.dirty}
                    fallback={<IconButton icon="refresh-cw" label="Reload from disk" onPress={reloadActive} />}
                  >
                    <ConfirmButton
                      iconOnly
                      label="Reload from disk"
                      tip="Reload from disk"
                      size="sm"
                      variant="bare"
                      timeoutMs={10_000}
                      confirmLabel={`Discard ${editor.armedDecision()?.path ?? active()} and reload?`}
                      onArm={() => editor.armDecision('reload')}
                      onConfirm={() => editor.confirmDecision('reload')}
                    >
                      <Icon name="refresh-cw" />
                    </ConfirmButton>
                  </Show>
                  <IconButton
                    icon="send"
                    label="Add to your message to the agent"
                    onPress={editor.sendSelectionToAgent}
                  />
                </Show>
              </>
            }
          />
          {/* A failure needs room for a sentence and its resolution actions. */}
          <Show when={editor.bulkRun()}>
            {(run) => (
              <Alert variant="banner" tone="warn">
                Closing files… <Button onPress={() => run().cancel()}>Cancel close</Button>
              </Alert>
            )}
          </Show>
          <Show when={editor.saveErr()}>
            <Alert variant="banner" tone="danger">
              {editor.saveErr()}
            </Alert>
          </Show>
          <Show when={editor.servicesOff()}>{(reason) => <Alert tone="muted">{reason()}</Alert>}</Show>
          <Show when={active() && editor.diskState()}>
            <Alert variant="banner" tone="warn">
              {editor.diskState() === 'deleted'
                ? 'Deleted on disk'
                : editor.diskState() === 'read-failed'
                  ? 'Could not read disk'
                  : editor.diskState() === 'recovered'
                    ? 'Recovered draft'
                    : 'Changed on disk'}
              <Button onPress={reloadActive}>Reload status</Button>
              <Show when={editor.diskState() !== 'deleted' && editor.diskState() !== 'read-failed'}>
                <Button onPress={editor.toggleCompare}>Compare</Button>
              </Show>
              <ConfirmButton
                timeoutMs={10_000}
                confirmLabel={`Discard ${editor.armedDecision()?.path ?? active()} and reload from disk?`}
                onArm={() => editor.armDecision('reload')}
                onConfirm={() => editor.confirmDecision('reload')}
              >
                Reload from disk
              </ConfirmButton>
              <Show
                when={
                  editor.diskState() === 'changed' ||
                  editor.diskState() === 'unknown' ||
                  editor.diskState() === 'recovered'
                }
              >
                <ConfirmButton
                  timeoutMs={10_000}
                  confirmLabel={`Overwrite ${editor.armedDecision()?.path ?? active()} at the shown disk version?`}
                  onArm={() => editor.armDecision('overwrite')}
                  onConfirm={() => editor.confirmDecision('overwrite')}
                >
                  Overwrite disk…
                </ConfirmButton>
              </Show>
              <Show when={editor.diskState() === 'deleted'}>
                <ConfirmButton
                  timeoutMs={10_000}
                  confirmLabel={`Recreate ${editor.armedDecision()?.path ?? active()}?`}
                  onArm={() => editor.armDecision('recreate')}
                  onConfirm={() => editor.confirmDecision('recreate')}
                >
                  Recreate file…
                </ConfirmButton>
                <Input label="Save as path" value={editor.saveAsPath()} onInput={editor.setSaveAsPath} />
                <Button onPress={editor.saveAs}>Save as…</Button>
              </Show>
            </Alert>
          </Show>
          <Show when={active() && editor.saveErr() && !editor.diskState()}>
            <Button onPress={() => void editor.save(active())}>Retry save</Button>
          </Show>
          <Show when={editor.compare() ? editor.comparisonDisk() : undefined}>
            {(snapshot) => (
              <EditorComparison path={active()!} disk={snapshot().text} draft={editor.comparisonDraft()} />
            )}
          </Show>
          {/* CodeMirror owns these pixels — its own DOM, its own keyboard, its own scrolling — so the
              pane hands it a box rather than a tree. `mount` is the element it attaches to, drawn by
              the host (ui/Rectangle.tsx). In terminal mode the same box holds the reader's own editor
              instead, keyed on the path so switching tabs starts a new one. */}
          <Show
            when={ptyPath()}
            fallback={
              <Show when={renderedPath()} fallback={fileView()}>
                <Show when={rendered()} fallback={<EmptyState busy>Loading…</EmptyState>}>
                  {/* The pane's own view is beside the slot rather than its default, because a
                    contributor's tree needs a scrolling column and CodeMirror needs the whole box.
                    It draws when nobody stands in, which for a matched key means an unsettled tie. */}
                  <Show when={!occupied()}>{fileView()}</Show>
                  <DetailColumn scroll={occupied()}>
                    <Slot
                      point={EDITOR_DOCUMENT_POINT}
                      key={editor.documentKey()}
                      taskId={taskId}
                      props={() => rendered()}
                      occupied={editor.setOccupied}
                    />
                  </DetailColumn>
                </Show>
              </Show>
            }
            keyed
          >
            {(path) => (
              <EditorTerminal taskId={taskId} path={path} onExit={(code) => editor.onEditorExit(path, code)} />
            )}
          </Show>
          <Show when={active()} keyed>
            {(path) => {
              const current = () => editor.status.isCurrent(path)
              return (
                <EditorStatus
                  path={path}
                  position={editor.status.position()}
                  selection={editor.status.selectedCharacters()}
                  language={languageName(languageIdForPath(path))}
                  indentation={editor.status.indentation()}
                  save={editor.status.save()}
                  preview={!!imagePath() || editor.documentRendered()}
                  external={!!ptyPath()}
                  wrap={editor.status.wrap()}
                  onToggleWrap={() => {
                    if (current()) editor.toggleWrap()
                  }}
                  onCopy={(absolute) => {
                    if (current()) copyPath(absolute)
                  }}
                  onReveal={() => {
                    if (current()) revealActiveFile()
                  }}
                  onIndentation={(value) => {
                    if (current()) editor.setIndentation(value)
                  }}
                  onRetry={() => {
                    if (current()) void editor.save(path)
                  }}
                />
              )
            }}
          </Show>
        </ListDetail>
      </Show>
    </Show>
  )
}
