import { For, createEffect, createMemo, createResource, createSignal, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  agentSessionsFor, clientEvents, effectiveModelPick, focusedPane, formatFileReference, prefsOptions,
  projectsOptions, readGeneratePick, readJson, registerCommands, saveGeneratePick,
  sendReferenceToAgent, taskBridge, taskStatus, type Task,
} from '@acorn/plugin-api/client'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'
import { Badge, Button, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import type { CodeRow, DiffFile, DiffSource } from '@acorn/plugin-api/ui/diff'
import { addReviewNote, deleteReviewNote, markReviewNotesSent } from './reviewNoteMutations'
import { emptyLocalStatus, reviewNotesRoute, type ModelPick, type ReviewNote } from '../shared/api'
import { formatReviewPrompt } from '../shared/reviewPrompt'
import { localGitApi } from './changesClient'
import { readChangeView, saveChangeView } from './changesPrefs'
import {
  changeKey, groupChanges, groupSections, isFolderKey, pickSelected, remoteReason,
  stackFor, stageableRows, stagedState, toPullFile, totals, viewNodes, type ChangeView, type RemoteAction,
} from './model'
import { CHANGES_PANE, changesBindings, changesCommands } from './commands'
import { createCommitState } from './commitState'

// Everything the Changes pane knows, held once per task and read by all four of its regions
// (docs/diff-rendering.md, docs/panes.md § Layout model).
//
// The pane is a `list-detail` layout, so the header, the file list, the commit bar and the diff are
// four components the host mounts rather than one closure. They share a resource, a selection, a diff
// source and an armed-confirm, and the host holds that: `model` on the pane contribution builds this
// once per task inside its own reactive root (client-core registries/paneModels.ts).
//
// A `.tsx` file even though it is the model: `DiffSource.lineExtra` is a component the source hands
// the viewer, and the source is the thing being shared.

// One viewer per task pane, so the scope's route key is a constant rather than a coordinate.
const CHANGES_ROUTE_KEY = 'changes'

export type ChangesModel = ReturnType<typeof createChangesModel>

export function createChangesModel(task: Task) {
  const api = taskBridge()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === task.projectId)
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal('')

  // One read behind the whole panel: the changes, the branch, its upstream, how far each way, and
  // whether a merge or rebase is mid-flight (docs/diff-rendering.md § Data flow). The list draws the
  // changes, the branch bar draws the rest.
  const [status, { refetch }] = createResource(
    () => task.id,
    async (id) => await localGitApi.status(id),
    { initialValue: emptyLocalStatus() },
  )
  // The rail's dirty poll is the refresh signal: when the worktree's change count moves, this
  // re-lists.
  createEffect(() => {
    const st = taskStatus(task.id)
    void st?.dirtyCount
    void st?.dirty
    void refetch()
  })
  // A commit is not a file change, so the dirty poll above does not see one: an agent committing in
  // its terminal leaves a clean tree and a branch one commit further ahead. `head:changed` is the
  // node noticing HEAD moved, and it is what makes the ahead count move within a poll rather than
  // waiting for the next edit (docs/diff-rendering.md § Data flow).
  onCleanup(clientEvents.on('head:changed', (event) => {
    if (event.taskId === task.id) void refetch()
  }))

  const groups = createMemo(() => groupChanges(status().changes))
  const selected = createMemo(() => pickSelected(groups(), selectedKey()))
  // Everything the header's one button and each group's checkbox decide from: the rows a staging
  // action can reach, and how much of them is already in the index.
  const stageable = createMemo(() => stageableRows(groups()))

  // List or tree, the sort, and the grouping: one device preference, so the shape survives a relaunch
  // and does not follow the reader to another machine (./changesPrefs.ts).
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const view = createMemo(() => readChangeView(prefs.data))

  // Which folders the reader has closed, this session only. A memo over the groups and the view, so
  // closing one re-flattens the tree without rebuilding it (`visibleNodes` is the cheap half).
  const [closedFolders, setClosedFolders] = createSignal<ReadonlySet<string>>(new Set())
  const sections = createMemo(() => groupSections(groups(), view()).map((section) => ({
    ...section,
    nodes: viewNodes(section.rows, view()),
  })))

  // "Add file/line to agent": drops a path[:line] draft into the agent composer.
  async function sendRef(ref: string) {
    const res = await sendReferenceToAgent(task.id, ref)
    if (!res.ok && res.reason) setActionError(res.reason)
    else setActionError('')
  }

  // Review notes: inline annotations on the local diff. Created through the shared line composer,
  // rendered under their anchor line, sent as one prompt through sendToAgent ('after-ready', queued
  // until the agent idles), and stamped sentAt on delivery.
  const [notes, { refetch: refetchNotes }] = createResource(
    () => task.id,
    (id) => readJson<ReviewNote[]>(reviewNotesRoute(id)),
    { initialValue: [] },
  )
  const unsent = () => (notes() ?? []).filter((n) => n.sentAt == null)
  const [sendMsg, setSendMsg] = createSignal('')

  const anchorOf = (r: CodeRow): { side: ReviewNote['side']; line: number } | null =>
    r.newNo != null ? { side: 'additions', line: r.newNo } : r.oldNo != null ? { side: 'deletions', line: r.oldNo } : null

  const notesForRow = (r: CodeRow): ReviewNote[] => {
    const a = anchorOf(r)
    if (!a) return []
    return (notes() ?? []).filter((n) => n.path === r.path && n.side === a.side && n.endLine === a.line)
  }

  // The stacked file set, and the changes behind it so fetchPatches can find a path's staging area.
  // A memo, not a plain getter: the viewer reads the file list from several memos of its own, and a
  // fresh DiffFile per read would rebuild the row model's file rows for nothing.
  const stack = createMemo(() => stackFor(groups(), selected()))
  const diffFiles = createMemo<DiffFile[]>(() => stack().map((c) => toPullFile(c, null)))

  // The diff column's whole contract with the shared viewer: the stacked files, their patches read on
  // demand, and review notes as the annotation the viewer itself has no concept of.
  const source: DiffSource = {
    scope: { taskId: task.id, routeKey: CHANGES_ROUTE_KEY },
    files: diffFiles,
    loading: () => status.loading,
    // Which files, and separately what they say. An agent saving a file moves the second every poll,
    // and the viewer keeps the reader's scroll position for that; a file appearing or going moves the
    // first, which does reset it.
    signature: () => stack().map(changeKey).join('\0'),
    contentSignature: () => `${stack().map((c) => `${changeKey(c)}:${c.additions}:${c.deletions}`).join('\0')}:${taskStatus(task.id)?.dirtyCount ?? 0}`,
    // Only after a click. pickSelected falls back to the first row so something renders on open, and
    // treating that as a scroll target would mean the remembered offset never won.
    selectedPath: () => (selectedKey() ? selected()?.path ?? '' : ''),
    cachedFile: () => null,
    fetchPatches: async (paths) => {
      const byPath = new Map(stack().map((c) => [c.path, c]))
      const out: DiffFile[] = []
      for (const path of paths) {
        const change = byPath.get(path)
        if (!change) continue
        const res = await localGitApi.diff(task.id, path, change.staged ? 'staged' : 'unstaged')
        // Thrown, not swallowed: the viewer turns a failed patch read into a row that says so and
        // offers Retry.
        if ('error' in res) throw new Error(res.error)
        out.push(toPullFile(change, res.patch))
      }
      return out
    },
    // Fills an expanded gap. `sha` is the staging area toPullFile put there, which is what says
    // whether the new side is the index or the file on disk.
    fileText: async ({ path, sha }) => {
      const res = await localGitApi.newSide(task.id, path, sha === 'staged' ? 'staged' : 'unstaged')
      if ('error' in res) throw new Error(res.error)
      return res.text
    },
    canComment: () => true,
    addComment: async (body, { row }) => {
      const a = anchorOf(row)
      if (!a) return
      await addReviewNote(task.id, { path: row.path, side: a.side, startLine: a.line, endLine: a.line, snippet: row.raw, body })
    },
    invalidate: () => {
      void refetch()
      void refetchNotes()
    },
    draftPrefix: `changes:${task.id}`,
    hasLineExtra: (row) => notesForRow(row).length > 0,
    // Which notes exist and where, so adding or deleting one re-measures the row it sits under. The
    // body length is in it because the note wraps, so its text is part of the height.
    lineExtraSignature: () => (notes() ?? []).map((n) => `${n.path}:${n.side}:${n.endLine}:${n.body.length}`).join('\0'),
    // Drawn in the same shape another plugin's marks are, which is what the host puts under a line
    // (plugins/annotations/AnnotationMarks.tsx): a state, the text, and who it belongs to. What a
    // review note has and a mark does not is a verb, because this one is the reader's own.
    lineExtra: (row) => (
      <For each={notesForRow(row)}>
        {(note) => (
          <Stack gap="none">
            <Inline gap="inline">
              <Badge size="xs" tone={note.sentAt ? 'ok' : 'warn'}>{note.sentAt ? '✓ sent' : '● unsent'}</Badge>
              <Text emphasis="muted" wrap>{note.body}</Text>
              <Button
                variant="bare"
                size="sm"
                iconOnly
                tone="danger"
                title="Delete note"
                label="Delete note"
                onPress={() => void deleteReviewNote(task.id, note.id).then(() => refetchNotes())}
              >✕</Button>
            </Inline>
          </Stack>
        )}
      </For>
    ),
    lineAction: {
      title: '⌥-click: add line reference to the agent composer',
      run: (row, event) => {
        if (!event.altKey) return
        const line = row.newNo ?? row.oldNo
        if (line != null) void sendRef(formatFileReference(row.path, line))
      },
    },
    find: { commandId: 'changes.diff.find', description: 'Find in changes', category: 'Changes', pane: 'changes' },
  }

  // Stage and commit actions. Discard is destructive, so it requires explicit confirmation.
  async function gitAction(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    const res = await fn()
    if (!res.ok && res.reason) setActionError(res.reason)
    else setActionError('')
    await refetch()
  }

  // Which backends the wand may spend — a stored key, or an agent CLI installed on this machine — ids
  // and labels only: the key stays on the node and is resolved inside `core.models.generateText`
  // (../server/routes/localGit.ts).
  //
  // Read once per task rather than on a poll. A connection is added in Settings and a CLI is installed
  // in a terminal, both of which are a trip out of the pane and back, and this model is rebuilt when
  // the pane is. An empty list is also what hides the button, so the pane draws no wand until the read
  // returns, which is the right way round.
  const [modelBackends] = createResource(
    () => (project()?.vcs === 'git' ? task.id : undefined),
    async (id) => await localGitApi.modelBackends(id).catch(() => []),
    { initialValue: [] },
  )
  // The shared "Generate with" default, resolved against what is actually available. The same pick
  // the workflow generator opens on, so a reader who chose an installed CLI here does not choose it
  // again there (client-core features/settings/models/generatePick.ts).
  const modelPick = createMemo(() => effectiveModelPick(modelBackends(), readGeneratePick(prefs.data)))

  // The commit editor: the message, the three options, and the two verbs (./commitState.ts). Built
  // here so it lives as long as the pane's model rather than as long as the footer, which the host
  // unmounts whenever the pane is showing the diff instead of the list.
  const editor = createCommitState({
    taskId: task.id,
    groups,
    headCommit: () => localGitApi.headCommit(task.id),
    commit: (message, options) => localGitApi.commit(task.id, message, options),
    commitMessage: (request) => localGitApi.commitMessage(task.id, request),
    onError: setActionError,
    onCommitted: async () => { await refetch() },
  })

  // The commit pair, the three remote palette rows, and the two chords, all registered for as long
  // as this model lives (./commands.ts). The model outlives every region of the pane and is disposed
  // before the next task's is built, so the registry never sees a duplicate id.
  const commands = registerCommands(changesCommands({
    commit: () => void editor.commit(),
    amend: () => void editor.amendCommit(),
    remote: (action) => void remote(action),
    // The model can be held for a task nobody is looking at, so a remote row asks the host which
    // pane has focus rather than assuming its own does.
    inPane: () => focusedPane(task.id) === CHANGES_PANE && project()?.vcs === 'git',
  }))
  const bindings = registerKeybindings(changesBindings(editor.editorFocused))
  onCleanup(() => { bindings.dispose(); commands.dispose() })

  // The bar's four verbs, behind one busy flag. One flag rather than four: they all talk to the same
  // remote, none of them is safe to start while another is running, and the bar has one place to
  // show pending anyway (./RemoteBar.tsx).
  //
  // Every reason goes to the alert rather than into the header, because git's refusals are multi-line
  // and because `remoteReason` turns the ones it recognises into a next step to press (./model.ts).
  const [remoteBusy, setRemoteBusy] = createSignal(false)
  const runRemote = (action: RemoteAction) => {
    // `changes:before-push` runs on the node, inside the push call, as the commit chain does.
    if (action === 'fetch') return localGitApi.fetch(task.id)
    if (action === 'pull') return localGitApi.pull(task.id, {})
    if (action === 'rebase') return localGitApi.pull(task.id, { rebase: true })
    if (action === 'push') return localGitApi.push(task.id, {})
    if (action === 'force') return localGitApi.push(task.id, { force: true })
    return localGitApi.abort(task.id)
  }
  async function remote(action: RemoteAction): Promise<void> {
    if (remoteBusy()) return
    setRemoteBusy(true)
    setActionError('')
    // Caught rather than left to reject: git's own refusals arrive as `{ ok: false, reason }`, but the
    // route itself can fail — a node that went away mid-fetch, a 120-second call the transport gave up
    // on — and the reader would otherwise press a button and watch nothing happen.
    const res = await runRemote(action)
      .catch((error: unknown) => ({ ok: false, reason: error instanceof Error ? error.message : 'The node did not answer.' }))
      .finally(() => setRemoteBusy(false))
    setActionError(res.ok ? '' : remoteReason(action, res.reason ?? 'The remote refused.'))
    await refetch()
  }

  async function sendNotes() {
    const list = unsent()
    if (!list.length) return
    const target = agentSessionsFor(task.id)[0]
    if (!target) return setSendMsg('No running agent session.')
    const res = await api.sendToAgent(target.id, formatReviewPrompt(list), 'after-ready')
    if (!res.ok) return setSendMsg(res.reason ?? 'Send failed.')
    await markReviewNotesSent(task.id, list.map((n) => n.id))
    await refetchNotes()
    setSendMsg(res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.')
  }

  return {
    task,
    project,
    isGit: () => project()?.vcs === 'git',
    status,
    groups,
    /** The sections the list draws, each with its rows already ordered and its nodes already shaped
     *  for the view. Rebuilt when the status or the preference moves, not when a folder is closed. */
    sections,
    view,
    /** One choice at a time, merged onto the rest: the three live in one key, so writing `mode` alone
     *  would put the sort and the grouping back to their defaults. */
    setView: (patch: Partial<ChangeView>) => void saveChangeView(queryClient, { ...view(), ...patch }),
    expanded: (key: string) => !closedFolders().has(key),
    /** Open or close one folder, answering whether anything moved. `false` hands the key back to the
     *  tier below, which is how Right on a file row still crosses a column in the terminal
     *  (client-core kit/keys/collectionIntents.ts). */
    foldFolder: (key: string, expand: boolean): boolean => {
      if (!isFolderKey(key)) return false
      const held = closedFolders()
      if (expand === !held.has(key)) return false
      const next = new Set(held)
      if (expand) next.delete(key)
      else next.add(key)
      setClosedFolders(next)
      return true
    },
    closedFolders,
    /** The header's `+N −M`, over every row the list draws. */
    totals: () => totals([...groups().conflicted, ...stageable()]),
    /** Which single button the header shows: Stage all until everything is in the index, then
     *  Unstage all, and neither on a clean tree. Conflicts are not part of it — they are resolved one
     *  at a time. */
    headerStage: () => (stageable().length === 0 ? 'none' : stagedState(stageable()) === 'all' ? 'unstage' : 'stage'),
    source,
    selected,
    isSelected: (c: Parameters<typeof changeKey>[0]) => selected() != null && changeKey(selected()!) === changeKey(c),
    select: (c: { path: string; staged: boolean }) => {
      setSelectedKey(changeKey(c))
      // The viewer skips a scroll to the file it last targeted, so clicking the same row twice would
      // do nothing. This is the force-scroll signal.
      clientEvents.emit('presentation:file-scroll', { routeKey: CHANGES_ROUTE_KEY, path: c.path })
    },
    actionError,
    sendMsg,
    /** Whether a fetch, pull, push or abort is in flight. One flag, because the bar has one place to
     *  show it and none of the four is safe to start while another runs. */
    remoteBusy,
    /** Run one remote verb: the bar's primary button, its menu, and the banner's Abort all come
     *  through here (./RemoteBar.tsx). */
    remote,
    /** The backends the wand may offer. Empty hides it: there is nothing to press. */
    modelBackends,
    /** Which backend and model a press will spend, or null when there is nothing to spend. */
    modelPick,
    /** Remember a pick for this device, for every Generate control rather than only this one. Written
     *  whole, because the model is only meaningful beside the backend that serves it. */
    setModelPick: (pick: ModelPick) => void saveGeneratePick(queryClient, pick),
    // The commit editor, spread flat: the footer and the expanded modal take the whole model, and a
    // second dot in every one of their reads would say nothing extra.
    ...editor,
    unsent,
    agentIdle: () => !!agentSessionsFor(task.id)[0]?.idle,
    // Paths, not a path: a row's checkbox sends one and a group's sends every unstaged path under it,
    // which is the shape the folder checkbox in the tree view needs too.
    stage: (paths: string[]) => gitAction(() => localGitApi.stage(task.id, paths)),
    unstage: (paths: string[]) => gitAction(() => localGitApi.unstage(task.id, paths)),
    stageAll: () => gitAction(() => localGitApi.stageAll(task.id)),
    unstageAll: () => gitAction(() => localGitApi.unstageAll(task.id)),
    // Both are destructive and both arm through `ConfirmButton`, so the button is the prompt and the
    // model just does the thing.
    discard: (path: string, untracked: boolean) => gitAction(() => localGitApi.discard(task.id, path, untracked)),
    discardAll: () => gitAction(() => localGitApi.discardAll(task.id)),
    sendRef,
    sendNotes,
  }
}

/** Re-exported so the pane and the model agree on one name for it. */
export { changeKey }
