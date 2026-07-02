import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { Task } from '../../queries'
import { fileStatusMeta } from '../../displayMeta'
import { getHighlighter } from '../../shiki'
import { DiffLine, NonCodeRow } from '../diff/DiffRows'
import { buildDiffRows, highlighterTokenize, isCodeRow, plainTokenize, type CodeRow, type Row } from '../diff/model'
import { taskStatus } from '../tasks/taskStatus'
import { terminalApi } from '../terminal/terminalClient'
import { changeKey, groupChanges, pickSelected, toPullFile } from './model'
import './changes.css'

// ChangesPane (docs/next 04 §B): a PR-style "Files changed" view over the task worktree's
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
      const diff = buildDiffRows(file, tokenize())
      return [{ kind: 'file', file }, ...(diff.length ? diff : [{ kind: 'nodiff' } as Row])]
    },
    { initialValue: [] },
  )

  const noop = async () => {}

  return (
    <section class="pane changes-pane">
      <div class="section-header">Changes (uncommitted)</div>
      <div class="changes-body">
        <div class="changes-list">
          <For each={[{ title: 'Staged', list: groups().staged }, { title: 'Changes', list: groups().unstaged }]}>
            {(group) => (
              <Show when={group.list.length}>
                <div class="changes-group-title muted">{group.title}</div>
                <For each={group.list}>
                  {(c) => {
                    const status = () => fileStatusMeta(c.status === 'untracked' ? 'added' : c.status)
                    return (
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
                    )
                  }}
                </For>
              </Show>
            )}
          </For>
          <Show when={!groups().staged.length && !groups().unstaged.length}>
            <p class="muted changes-empty">Working tree clean.</p>
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
                >
                  <Show
                    when={isCodeRow(row) ? row : null}
                    fallback={
                      <NonCodeRow row={row as Exclude<Row, CodeRow>} onMutated={() => void refetch()} resolveThread={noop} reply={noop} />
                    }
                  >
                    {(r) => <DiffLine r={r()} canAdd={false} addComment={noop} onMutated={() => void refetch()} />}
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
