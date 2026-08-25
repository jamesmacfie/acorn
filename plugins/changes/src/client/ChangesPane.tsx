import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { agentSessionsFor, clientEvents, fileStatusMeta, formatFileReference, projectsOptions, readJson, sendReferenceToAgent, type Task, taskBridge, taskStatus } from '@acorn/plugin-api/client'
import { addReviewNote, deleteReviewNote, markReviewNotesSent } from './reviewNoteMutations'
import { reviewNotesRoute, type ReviewNote } from '../shared/api'
import { formatReviewPrompt } from '../shared/reviewPrompt'
import { Alert, Button, CopyButton, DiffPane, ListDetail, Row, createArmedConfirm } from '@acorn/plugin-api/ui'
import type { CodeRow, DiffFile, DiffSource } from '@acorn/plugin-api/ui/diff'
import { localGitApi } from './localGitClient'
import { changeKey, groupChanges, pickSelected, stackFor, toPullFile } from './model'
import './changes.css'

// ChangesPane: a PR-style "Files changed" view over the task worktree's uncommitted changes. The
// diff column is the shared viewer (client-core's DiffPane, docs/diff-rendering.md), the same
// component the GitHub pull-request pane renders, filled in from local:changes and local:diff rather
// than from provider patches. Refreshes on the dirty-poll signal (taskStatus).
//
// The list on the left is a navigator, not a selector: every file's hunks are stacked in one
// scroller and clicking a row scrolls to it, the way the pull-request pane's file list works. The
// per-file git actions stay on the rows. One staging area is stacked at a time; `stackFor` in
// model.ts says why.
// One viewer per task pane, so the scope's route key is a constant rather than a coordinate.
const CHANGES_ROUTE_KEY = 'changes'

export default function ChangesPane(props: { task: Task }) {
  const api = taskBridge()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === props.task.projectId)
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal('')
  // Arm-to-confirm for the two discard actions.
  const discardArmed = createArmedConfirm()

  const [changes, { refetch }] = createResource(
    () => props.task.id,
    async (id) => await localGitApi.changes(id),
    { initialValue: [] },
  )
  // The rail's dirty poll is the refresh signal: when the worktree's change count moves, this
  // re-lists.
  createEffect(() => {
    const st = taskStatus(props.task.id)
    void st?.dirtyCount
    void st?.dirty
    void refetch()
  })

  const groups = createMemo(() => groupChanges(changes() ?? []))
  const selected = createMemo(() => pickSelected(groups(), selectedKey()))

  // "Add file/line to agent": drops a path[:line] draft into the agent composer.
  async function sendRef(ref: string) {
    const res = await sendReferenceToAgent(props.task.id, ref)
    if (!res.ok && res.reason) setActionError(res.reason)
    else setActionError('')
  }

  // Review notes: inline annotations on the local diff. Created through the shared line composer,
  // rendered under their anchor line, sent as one prompt through sendToAgent ('after-ready', queued
  // until the agent idles), and stamped sentAt on delivery.
  const [notes, { refetch: refetchNotes }] = createResource(
    () => props.task.id,
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
    scope: { taskId: props.task.id, routeKey: CHANGES_ROUTE_KEY },
    files: diffFiles,
    loading: () => changes.loading,
    // Which files, and separately what they say. An agent saving a file moves the second every poll,
    // and the viewer keeps the reader's scroll position for that; a file appearing or going moves the
    // first, which does reset it.
    signature: () => stack().map(changeKey).join('\0'),
    contentSignature: () => `${stack().map((c) => `${changeKey(c)}:${c.additions}:${c.deletions}`).join('\0')}:${taskStatus(props.task.id)?.dirtyCount ?? 0}`,
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
        const res = await localGitApi.diff(props.task.id, path, change.staged ? 'staged' : 'unstaged')
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
      const res = await localGitApi.newSide(props.task.id, path, sha === 'staged' ? 'staged' : 'unstaged')
      if ('error' in res) throw new Error(res.error)
      return res.text
    },
    canComment: () => true,
    addComment: async (body, { row }) => {
      const a = anchorOf(row)
      if (!a) return
      await addReviewNote(props.task.id, { path: row.path, side: a.side, startLine: a.line, endLine: a.line, snippet: row.raw, body })
    },
    invalidate: () => {
      void refetch()
      void refetchNotes()
    },
    draftPrefix: `changes:${props.task.id}`,
    hasLineExtra: (row) => notesForRow(row).length > 0,
    // Which notes exist and where, so adding or deleting one re-measures the row it sits under. The
    // body length is in it because the note wraps, so its text is part of the height.
    lineExtraSignature: () => (notes() ?? []).map((n) => `${n.path}:${n.side}:${n.endLine}:${n.body.length}`).join('\0'),
    lineExtra: (row) => (
      <For each={notesForRow(row)}>
        {(note) => (
          <div class="review-note" classList={{ 'review-note-sent': note.sentAt != null }}>
            <span class="review-note-status" title={note.sentAt ? 'Sent to agent' : 'Not sent yet'}>
              {note.sentAt ? '✓ sent' : '● unsent'}
            </span>
            <span class="review-note-body">{note.body}</span>
            <Button
              variant="bare"
              size="sm"
              iconOnly
              tone="danger"
              title="Delete note"
              aria-label="Delete note"
              onClick={() => void deleteReviewNote(props.task.id, note.id).then(() => refetchNotes())}
            >✕</Button>
          </div>
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
  async function discard(path: string, untracked: boolean) {
    if (!discardArmed.request(`file:${path}`)) return
    await gitAction(() => localGitApi.discard(props.task.id, path, untracked))
  }
  // Bulk toolbar actions: whole working tree at once. Discard-all is destructive, so it requires
  // confirmation.
  async function discardAll() {
    if (!discardArmed.request('all')) return
    await gitAction(() => localGitApi.discardAll(props.task.id))
  }
  async function commit() {
    if (!commitMsg().trim()) return
    const res = await localGitApi.commit(props.task.id, commitMsg())
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
    const res = await localGitApi.push(props.task.id)
    setPushing(false)
    if (res.ok) setPushMsg('Pushed')
    else setActionError(res.reason ?? 'Push failed.')
  }

  async function sendNotes() {
    const list = unsent()
    if (!list.length) return
    const target = agentSessionsFor(props.task.id)[0]
    if (!target) return setSendMsg('No running agent session.')
    const res = await api.sendToAgent(target.id, formatReviewPrompt(list), 'after-ready')
    if (!res.ok) return setSendMsg(res.reason ?? 'Send failed.')
    await markReviewNotesSent(props.task.id, list.map((n) => n.id))
    await refetchNotes()
    setSendMsg(res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.')
  }

  return (
    <Show when={project()?.vcs === 'git'} fallback={
      <section class="pane changes-pane">
        <div class="section-header changes-header">Changes</div>
        <div class="changes-empty">
          <p class="muted">Changes are unavailable for this non-Git project.</p>
          <Show when={project()?.path}>
            <p class="muted copyable">Project folder: {project()!.path}<CopyButton text={() => project()!.path ?? ''} title="Copy project folder" /></p>
          </Show>
        </div>
      </section>
    }>
    <section class="pane changes-pane">
      <div class="section-header changes-header">
        <span>Changes (uncommitted)</span>
        <Show when={project()?.path}>
          <span class="muted copyable">{project()!.path}<CopyButton text={() => project()!.path ?? ''} title="Copy project folder" /></span>
        </Show>
        <Show when={groups().staged.length || groups().unstaged.length}>
          <span class="changes-toolbar">
            <Button variant="bare" size="sm" iconOnly disabled={!groups().unstaged.length} data-tip="Stage all" data-tip-sub="git add -A" onClick={() => void gitAction(() => localGitApi.stageAll(props.task.id))}>++</Button>
            <Button variant="bare" size="sm" iconOnly disabled={!groups().staged.length} data-tip="Unstage all" data-tip-sub="git reset" onClick={() => void gitAction(() => localGitApi.unstageAll(props.task.id))}>−−</Button>
            <Button variant="bare" size="sm" iconOnly data-armed={discardArmed.armed() === 'all' ? '' : undefined} data-tip={discardArmed.armed() === 'all' ? 'Click again to discard all' : 'Discard all'} data-tip-sub="Reset tracked + remove untracked — cannot be undone" onClick={() => void discardAll()}>{discardArmed.armed() === 'all' ? '?' : '↺'}</Button>
          </span>
        </Show>
        <Button disabled={pushing()} data-tip="Push to origin" data-tip-sub="git push -u origin HEAD" onClick={() => void push()}>
          {pushing() ? 'Pushing…' : 'Push → origin'}
        </Button>
        <Show when={pushMsg()}>
          <span class="changes-push-status">{pushMsg()}</span>
        </Show>
        <Show when={unsent().length}>
          <Button title="Bracketed-paste the unsent notes into the task's agent (queued until idle)" onClick={() => void sendNotes()}>
            Send {unsent().length} note{unsent().length === 1 ? '' : 's'} → agent{agentSessionsFor(props.task.id)[0]?.idle ? ' ●' : ''}
          </Button>
        </Show>
        <Show when={sendMsg()}>
          <span class="muted">{sendMsg()}</span>
        </Show>
        <Show when={actionError()}><Alert>{actionError()}</Alert></Show>
      </div>
      <ListDetail
        listLabel="Changed files"
        listClass="changes-list"
        list={
          <>
            <For each={[{ title: 'Staged', list: groups().staged }, { title: 'Changes', list: groups().unstaged }]}>
              {(group) => (
                <Show when={group.list.length}>
                  <div class="section-header changes-group-head">{group.title} ({group.list.length})</div>
                  <For each={group.list}>
                    {(c) => {
                      const status = () => fileStatusMeta(c.status === 'untracked' ? 'added' : c.status)
                      return (
                        <Row
                          density="compact"
                          reveal
                          selected={selected() != null && changeKey(selected()!) === changeKey(c)}
                          onActivate={() => {
                            setSelectedKey(changeKey(c))
                            // The viewer skips a scroll to the file it last targeted, so clicking the
                            // same row twice would do nothing. This is the force-scroll signal.
                            clientEvents.emit('presentation:file-scroll', { routeKey: CHANGES_ROUTE_KEY, path: c.path })
                          }}
                          title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
                          leading={<span class={`file-status file-status-${status().tone}`}>{status().letter}</span>}
                          meta={
                            <Show when={c.additions != null}>
                              <span class="file-stat add">+{c.additions}</span>
                              <span class="file-stat del">&#8722;{c.deletions ?? 0}</span>
                            </Show>
                          }
                          trailing={<>
                          
                          <Show
                            when={c.staged}
                            fallback={
                              <>
                                <Button variant="bare" size="sm" iconOnly data-tip="Stage file" data-tip-sub="git add" onClick={() => void gitAction(() => localGitApi.stage(props.task.id, c.path))}>+</Button>
                                <Button variant="bare" size="sm" iconOnly data-armed={discardArmed.armed() === `file:${c.path}` ? '' : undefined} data-tip={discardArmed.armed() === `file:${c.path}` ? 'Click again to discard' : 'Discard changes'} data-tip-sub="Restore this file — cannot be undone" onClick={() => void discard(c.path, c.status === 'untracked')}>{discardArmed.armed() === `file:${c.path}` ? '?' : '↺'}</Button>
                              </>
                            }
                          >
                            <Button variant="bare" size="sm" iconOnly data-tip="Unstage file" data-tip-sub="git restore --staged" onClick={() => void gitAction(() => localGitApi.unstage(props.task.id, c.path))}>−</Button>
                          </Show>
                          <Button
                            variant="bare"
                            size="sm"
                            iconOnly
                            data-tip="Send to agent"
                            data-tip-sub="Add file reference to the composer"
                            onClick={() => void sendRef(formatFileReference(c.path))}
                          >→</Button>
                          </>}
                        >
                          <span class="changes-row-path">{c.path}</span>
                        </Row>
                      )
                    }}
                  </For>
                </Show>
              )}
            </For>
            <Show when={!groups().staged.length && !groups().unstaged.length}>
              <p class="muted changes-empty">Working tree clean.</p>
            </Show>
            <Show when={groups().staged.length}>
              <div class="changes-commit">
                <input
                  class="ui-input"
                  type="text"
                  placeholder="Commit message"
                  value={commitMsg()}
                  onInput={(e) => setCommitMsg(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void commit()}
                />
                <Button disabled={!commitMsg().trim()} onClick={() => void commit()}>
                  Commit staged
                </Button>
              </div>
            </Show>
          </>
        }
      >
        <DiffPane source={source} />
      </ListDetail>
    </section>
    </Show>
  )
}
