import { For, createEffect, createMemo, createResource, createSignal } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import {
  agentSessionsFor, clientEvents, formatFileReference, projectsOptions, readJson,
  sendReferenceToAgent, taskBridge, taskStatus, type Task,
} from '@acorn/plugin-api/client'
import { Badge, Button, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import type { CodeRow, DiffFile, DiffSource } from '@acorn/plugin-api/ui/diff'
import { addReviewNote, deleteReviewNote, markReviewNotesSent } from './reviewNoteMutations'
import { reviewNotesRoute, type ReviewNote } from '../shared/api'
import { formatReviewPrompt } from '../shared/reviewPrompt'
import { localGitApi } from './localGitClient'
import { changeKey, groupChanges, pickSelected, stackFor, toPullFile } from './model'

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

  const [changes, { refetch }] = createResource(
    () => task.id,
    async (id) => await localGitApi.changes(id),
    { initialValue: [] },
  )
  // The rail's dirty poll is the refresh signal: when the worktree's change count moves, this
  // re-lists.
  createEffect(() => {
    const st = taskStatus(task.id)
    void st?.dirtyCount
    void st?.dirty
    void refetch()
  })

  const groups = createMemo(() => groupChanges(changes() ?? []))
  const selected = createMemo(() => pickSelected(groups(), selectedKey()))

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
    loading: () => changes.loading,
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
  const [commitMsg, setCommitMsg] = createSignal('')
  async function gitAction(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    const res = await fn()
    if (!res.ok && res.reason) setActionError(res.reason)
    else setActionError('')
    await refetch()
  }
  async function commit() {
    if (!commitMsg().trim()) return
    // The node runs the `changes:before-commit` chain inside this call; a veto comes back as a reason
    // (plugins/changes/src/main/localGit.ts).
    const res = await localGitApi.commit(task.id, commitMsg())
    if (!res.ok) return setActionError(res.reason ?? 'Commit failed.')
    setActionError('')
    setCommitMsg('')
    await refetch()
  }
  // Push HEAD to origin. Network-bound, so this shows pending; errors go to an alert, since git's
  // reason is multi-line and would look shouty in the uppercased header.
  const [pushing, setPushing] = createSignal(false)
  const [pushMsg, setPushMsg] = createSignal('')
  async function push() {
    if (pushing()) return
    setPushing(true)
    setPushMsg('')
    // As above: `changes:before-push` runs on the node, inside this call.
    const res = await localGitApi.push(task.id)
    setPushing(false)
    if (res.ok) setPushMsg('Pushed')
    else setActionError(res.reason ?? 'Push failed.')
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
    groups,
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
    pushMsg,
    pushing,
    commitMsg,
    setCommitMsg,
    unsent,
    agentIdle: () => !!agentSessionsFor(task.id)[0]?.idle,
    stage: (path: string) => gitAction(() => localGitApi.stage(task.id, path)),
    unstage: (path: string) => gitAction(() => localGitApi.unstage(task.id, path)),
    stageAll: () => gitAction(() => localGitApi.stageAll(task.id)),
    unstageAll: () => gitAction(() => localGitApi.unstageAll(task.id)),
    // Both are destructive and both arm through `ConfirmButton`, so the button is the prompt and the
    // model just does the thing.
    discard: (path: string, untracked: boolean) => gitAction(() => localGitApi.discard(task.id, path, untracked)),
    discardAll: () => gitAction(() => localGitApi.discardAll(task.id)),
    sendRef,
    commit,
    push,
    sendNotes,
  }
}

/** Re-exported so the pane and the model agree on one name for it. */
export { changeKey }
