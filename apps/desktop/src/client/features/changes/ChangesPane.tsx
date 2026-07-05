import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { Task } from '../../queries'
import { readJson } from '../../apiClient'
import { addReviewNote, deleteReviewNote, markReviewNotesSent } from '../../mutations'
import { fileStatusMeta } from '../../displayMeta'
import { getHighlighter } from '../../shiki'
import { reviewNotesRoute, type ReviewNote } from '../../../shared/api'
import { formatReviewPrompt } from '../../../shared/reviewPrompt'
import { DiffLine, NonCodeRow, type LineComposerController } from '../diff/DiffRows'
import { buildDiffRows, highlighterTokenize, isCodeRow, plainTokenize, type CodeRow, type Row } from '../diff/model'
import { formatFileReference, sendReferenceToAgent } from '../agent/reference'
import { taskStatus } from '../tasks/taskStatus'
import { agentSessionsFor } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { changeKey, groupChanges, pickSelected, toPullFile } from './model'
import './changes.css'

// ChangesPane (docs/panes.md): a PR-style "Files changed" view over the task worktree's
// UNCOMMITTED changes — the existing diff pipeline (diff.ts synth → gitdiff-parser → DiffRows)
// fed by the local:changes/local:diff IPC instead of GitHub patches. Refreshes on the existing
// dirty-poll signal (taskStatus). Read-only in P1; stage/commit actions land in P4.
export default function ChangesPane(props: { task: Task }) {
  const api = terminalApi()
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null)

  const [changes, { refetch }] = createResource(
    () => props.task.id,
    async (id) => (api ? await api.local.changes(id) : []),
    { initialValue: [] },
  )
  // The rail's dirty poll is the refresh signal — when the worktree's change count moves, re-list.
  createEffect(() => {
    const st = taskStatus(props.task.id)
    void st?.dirtyCount
    void st?.dirty
    void refetch()
  })

  const groups = createMemo(() => groupChanges(changes() ?? []))
  const selected = createMemo(() => pickSelected(groups(), selectedKey()))

  const [hl] = createResource(() => getHighlighter())
  const tokenize = () => {
    const highlighter = hl()
    return highlighter ? highlighterTokenize(highlighter) : plainTokenize
  }

  const [rows] = createResource(
    () => {
      const sel = selected()
      return sel ? { taskId: props.task.id, sel, tick: taskStatus(props.task.id)?.dirtyCount ?? 0 } : null
    },
    async (src): Promise<Row[]> => {
      if (!api) return []
      const res = await api.local.diff(src.taskId, src.sel.path, src.sel.staged ? 'staged' : 'unstaged')
      if ('error' in res) return []
      const file = toPullFile(src.sel, res.patch)
      // Whole-file view: the patch carries full context (server -U1e6), so drop the expand gaps and
      // hunk-header rows — every line is already shown, just with +/- highlights.
      const diff = buildDiffRows(file, tokenize()).filter((r) => r.kind !== 'gap' && r.kind !== 'hunk')
      return [{ kind: 'file', file }, ...(diff.length ? diff : [{ kind: 'nodiff' } as Row])]
    },
    { initialValue: [] },
  )

  const noop = async () => {}

  // "Add file/line to agent" (docs/panes.md): drop a path[:line] draft into the agent composer.
  async function sendRef(ref: string) {
    const res = await sendReferenceToAgent(props.task.id, ref)
    if (!res.ok && res.reason) window.alert(res.reason)
  }

  // Review notes (docs/panes.md): inline annotations on the local diff. Created via the shared
  // line composer, rendered under their anchor line, sent as one prompt via sendToAgent
  // ('after-ready' — queued until the agent idles) and stamped sentAt on delivery.
  const [notes, { refetch: refetchNotes }] = createResource(
    () => props.task.id,
    (id) => readJson<ReviewNote[]>(reviewNotesRoute(id)),
    { initialValue: [] },
  )
  const unsent = () => (notes() ?? []).filter((n) => n.sentAt == null)
  const [sendMsg, setSendMsg] = createSignal('')

  const composers = new Map<string, LineComposerController>()
  function composerFor(key: string): LineComposerController {
    let c = composers.get(key)
    if (!c) {
      const [isOpen, setOpen] = createSignal(false)
      const [body, setBody] = createSignal('')
      c = { isOpen, body, setOpen, setBody }
      composers.set(key, c)
    }
    return c
  }

  const anchorOf = (r: CodeRow): { side: ReviewNote['side']; line: number } | null =>
    r.newNo != null ? { side: 'additions', line: r.newNo } : r.oldNo != null ? { side: 'deletions', line: r.oldNo } : null

  async function createNote(r: CodeRow, body: string) {
    const a = anchorOf(r)
    if (!a) return
    await addReviewNote(props.task.id, { path: r.path, side: a.side, startLine: a.line, endLine: a.line, snippet: r.raw, body })
    await refetchNotes()
  }

  // Stage/commit actions (docs/panes.md). Discard is destructive → explicit confirm.
  const [commitMsg, setCommitMsg] = createSignal('')
  async function gitAction(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    const res = await fn()
    if (!res.ok && res.reason) window.alert(res.reason)
    await refetch()
  }
  async function discard(path: string, untracked: boolean) {
    if (!api) return
    if (!window.confirm(`Discard changes to ${path}? This cannot be undone.`)) return
    await gitAction(() => api.local.discard(props.task.id, path, untracked))
  }
  // Bulk toolbar actions (docs/panes.md): whole working tree at once. Discard-all is destructive → confirm.
  async function discardAll() {
    if (!api) return
    if (!window.confirm('Discard ALL changes, including untracked files? This cannot be undone.')) return
    await gitAction(() => api.local.discardAll(props.task.id))
  }
  async function commit() {
    if (!api || !commitMsg().trim()) return
    const res = await api.local.commit(props.task.id, commitMsg())
    if (!res.ok) return window.alert(res.reason ?? 'Commit failed.')
    setCommitMsg('')
    await refetch()
  }
  // Push HEAD to origin (docs/panes.md). Network-bound → show pending; errors go to an alert
  // (git's reason is multi-line and would look shouty in the uppercased header).
  const [pushing, setPushing] = createSignal(false)
  const [pushMsg, setPushMsg] = createSignal('')
  async function push() {
    if (!api || pushing()) return
    setPushing(true)
    setPushMsg('')
    const res = await api.local.push(props.task.id)
    setPushing(false)
    if (res.ok) setPushMsg('Pushed')
    else window.alert(res.reason ?? 'Push failed.')
  }

  const notesForRow = (r: CodeRow): ReviewNote[] => {
    const a = anchorOf(r)
    if (!a) return []
    return (notes() ?? []).filter((n) => n.path === r.path && n.side === a.side && n.endLine === a.line)
  }

  async function sendNotes() {
    const list = unsent()
    if (!list.length) return
    const target = agentSessionsFor(props.task.id)[0]
    if (!target || !api) return setSendMsg('No running agent session.')
    const res = await api.sendToAgent(target.id, formatReviewPrompt(list), 'after-ready')
    if (!res.ok) return setSendMsg(res.reason ?? 'Send failed.')
    await markReviewNotesSent(props.task.id, list.map((n) => n.id))
    await refetchNotes()
    setSendMsg(res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.')
  }

  return (
    <section class="pane changes-pane">
      <div class="section-header changes-header">
        <span>Changes (uncommitted)</span>
        <Show when={groups().staged.length || groups().unstaged.length}>
          <span class="changes-toolbar">
            <button type="button" class="changes-to-agent" disabled={!groups().unstaged.length} data-tip="Stage all" data-tip-sub="git add -A" onClick={() => api && void gitAction(() => api.local.stageAll(props.task.id))}>++</button>
            <button type="button" class="changes-to-agent" disabled={!groups().staged.length} data-tip="Unstage all" data-tip-sub="git reset" onClick={() => api && void gitAction(() => api.local.unstageAll(props.task.id))}>−−</button>
            <button type="button" class="changes-to-agent" data-tip="Discard all" data-tip-sub="Reset tracked + remove untracked — cannot be undone" onClick={() => void discardAll()}>↺</button>
          </span>
        </Show>
        <button type="button" class="changes-send" disabled={pushing()} data-tip="Push to origin" data-tip-sub="git push -u origin HEAD" onClick={() => void push()}>
          {pushing() ? 'Pushing…' : 'Push → origin'}
        </button>
        <Show when={pushMsg()}>
          <span class="changes-push-status">{pushMsg()}</span>
        </Show>
        <Show when={unsent().length}>
          <button type="button" class="changes-send" title="Bracketed-paste the unsent notes into the task's agent (queued until idle)" onClick={() => void sendNotes()}>
            Send {unsent().length} note{unsent().length === 1 ? '' : 's'} → agent{agentSessionsFor(props.task.id)[0]?.idle ? ' ●' : ''}
          </button>
        </Show>
        <Show when={sendMsg()}>
          <span class="muted">{sendMsg()}</span>
        </Show>
      </div>
      <div class="changes-body">
        <div class="changes-list">
          <For each={[{ title: 'Staged', list: groups().staged }, { title: 'Changes', list: groups().unstaged }]}>
            {(group) => (
              <Show when={group.list.length}>
                <div class="section-header changes-group-head">{group.title} ({group.list.length})</div>
                <For each={group.list}>
                  {(c) => {
                    const status = () => fileStatusMeta(c.status === 'untracked' ? 'added' : c.status)
                    return (
                      <div class="changes-row-wrap">
                        <button
                          type="button"
                          class="changes-row"
                          classList={{ active: selected() != null && changeKey(selected()!) === changeKey(c) }}
                          title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
                          onClick={() => setSelectedKey(changeKey(c))}
                        >
                          <span class={`file-status file-status-${status().tone}`}>{status().letter}</span>
                          <span class="changes-row-path">{c.path}</span>
                          <Show when={c.additions != null}>
                            <span class="file-stat add">+{c.additions}</span>
                            <span class="file-stat del">&#8722;{c.deletions ?? 0}</span>
                          </Show>
                        </button>
                        <Show
                          when={c.staged}
                          fallback={
                            <>
                              <button type="button" class="changes-to-agent" data-tip="Stage file" data-tip-sub="git add" onClick={() => api && void gitAction(() => api.local.stage(props.task.id, c.path))}>+</button>
                              <button type="button" class="changes-to-agent" data-tip="Discard changes" data-tip-sub="Restore this file — cannot be undone" onClick={() => void discard(c.path, c.status === 'untracked')}>↺</button>
                            </>
                          }
                        >
                          <button type="button" class="changes-to-agent" data-tip="Unstage file" data-tip-sub="git restore --staged" onClick={() => api && void gitAction(() => api.local.unstage(props.task.id, c.path))}>−</button>
                        </Show>
                        <button
                          type="button"
                          class="changes-to-agent"
                          data-tip="Send to agent"
                          data-tip-sub="Add file reference to the composer"
                          onClick={() => void sendRef(formatFileReference(c.path))}
                        >→</button>
                      </div>
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
                class="integration-key-input"
                type="text"
                placeholder="Commit message"
                value={commitMsg()}
                onInput={(e) => setCommitMsg(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && void commit()}
              />
              <button type="button" class="overlay-btn" disabled={!commitMsg().trim()} onClick={() => void commit()}>
                Commit staged
              </button>
            </div>
          </Show>
        </div>
        <div class="diff compare-diff changes-diff">
          <div class="diff-rows">
            <For each={rows() ?? []}>
              {(row) => (
                <div
                  class="diff-row"
                  classList={{
                    'diff-hunk': row.kind === 'hunk',
                    'diff-add': row.kind === 'insert',
                    'diff-del': row.kind === 'delete',
                    'diff-file-row': row.kind === 'file',
                    'diff-thread-row': row.kind === 'nodiff' || row.kind === 'load',
                  }}
                  title={isCodeRow(row) ? '⌥-click: add line reference to the agent composer' : undefined}
                  onClick={(e) => {
                    if (!e.altKey || !isCodeRow(row)) return
                    const line = row.newNo ?? row.oldNo
                    if (line != null) void sendRef(formatFileReference(row.path, line))
                  }}
                >
                  <Show
                    when={isCodeRow(row) ? row : null}
                    fallback={
                      <NonCodeRow row={row as Exclude<Row, CodeRow>} onMutated={() => void refetch()} resolveThread={noop} reply={noop} />
                    }
                  >
                    {(r) => (
                      <>
                        <DiffLine
                          r={r()}
                          canAdd={anchorOf(r()) != null}
                          addComment={(body) => createNote(r(), body)}
                          onMutated={() => void refetchNotes()}
                          composer={composerFor(`${r().path}:${r().kind}:${r().oldNo ?? ''}:${r().newNo ?? ''}`)}
                        />
                        <For each={notesForRow(r())}>
                          {(note) => (
                            <div class="review-note" classList={{ 'review-note-sent': note.sentAt != null }}>
                              <span class="review-note-status" title={note.sentAt ? 'Sent to agent' : 'Not sent yet'}>
                                {note.sentAt ? '✓ sent' : '● unsent'}
                              </span>
                              <span class="review-note-body">{note.body}</span>
                              <button
                                type="button"
                                class="review-note-delete"
                                title="Delete note"
                                onClick={() => void deleteReviewNote(props.task.id, note.id).then(() => refetchNotes())}
                              >✕</button>
                            </div>
                          )}
                        </For>
                      </>
                    )}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  )
}
