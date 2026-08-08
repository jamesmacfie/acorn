import { createMemo, For, Show } from 'solid-js'
import type { Accessor } from 'solid-js'
import Icon from '@acorn/client-core/ui/Icon.tsx'
import CopyButton from '@acorn/client-core/ui/CopyButton.tsx'
import { formatRelativeTime } from '@acorn/client-core/lib/formatRelativeTime.ts'
import { splitLinearIds } from './contentLinks'
import type { Pull, PullConflicts } from '../contract/api'
import { UserAvatar } from '@acorn/client-core/ui/UserAvatar.tsx'

function LinearText(props: { text: string; prefixes: string[]; onOpen: (id: string) => void }) {
  const parts = createMemo(() => splitLinearIds(props.text, props.prefixes))
  return (
    <For each={parts()}>
      {(part) => part.id ? <a class="linear-inline-link" onClick={() => props.onOpen(part.id!)}>{part.text}</a> : <>{part.text}</>}
    </For>
  )
}

type PullWithBody = Pull & { body: string | null; headSha: string | null }
type AsyncAction = { run: () => Promise<unknown>; pending: boolean }

export function PullSummary(props: {
  pull: Accessor<PullWithBody>
  bindNavigatorScroll: (element: HTMLDivElement) => void
  fileSummary: Accessor<{ count: number; additions: number; deletions: number }>
  linearPrefixes: Accessor<string[]>
  onOpenIssue: (id: string) => void
  mergeMethod: Accessor<string>
  setMergeMethod: (method: string) => void
  run: (promise: Promise<unknown>) => void
  disableAutoMerge: AsyncAction
  enableAutoMerge: AsyncAction
  merge: AsyncAction
  close: AsyncAction
  draft: { run: (draft: boolean) => Promise<unknown>; pending: boolean }
  reopen: AsyncAction
  actionError: Accessor<string>
  conflicting: boolean
  conflicts: Accessor<PullConflicts | undefined>
  conflictsLoading: Accessor<boolean>
  conflictsRef: (element: HTMLDetailsElement) => void
  selectFile: (path: string) => void
}) {
  return (
    <>
      <div class="pr-detail-header" ref={props.bindNavigatorScroll}>
        <div class="pr-detail-title">
          <span class="pr-num copyable">#{props.pull().number}<CopyButton text={() => String(props.pull().number)} title="Copy PR number" /></span>{' '}<LinearText text={props.pull().title} prefixes={props.linearPrefixes()} onOpen={props.onOpenIssue} />
        </div>
        <div class="pr-detail-meta muted">
          <span class={`state-badge state-${props.pull().state}`}>{props.pull().draft ? 'draft' : props.pull().state}</span>
          <Show when={props.pull().author}>
            {(author) => <span class="identity-chip"><UserAvatar login={author()} /><span>{author()}</span></span>}
          </Show>
          <span class="branch-flow">
            <button class="branch-chip" title={props.pull().baseRef ?? 'base'} onClick={() => navigator.clipboard.writeText(props.pull().baseRef ?? '')}>
              <span class="branch-chip-label">{props.pull().baseRef ?? 'base'}</span><Icon name="copy" class="branch-chip-copy" size={12} />
            </button>
            <span class="branch-arrow">←</span>
            <button class="branch-chip" title={props.pull().headRef ?? 'head'} onClick={() => navigator.clipboard.writeText(props.pull().headRef ?? '')}>
              <span class="branch-chip-label">{props.pull().headRef ?? 'head'}</span><Icon name="copy" class="branch-chip-copy" size={12} />
            </button>
          </span>
          <span>{props.fileSummary().count} files · <span class="file-stat add">+{props.fileSummary().additions}</span> / <span class="file-stat del">−{props.fileSummary().deletions}</span></span>
          <Show when={formatRelativeTime(props.pull().updatedAt)}>{(age) => <span>{age()}</span>}</Show>
        </div>
        <Show when={props.pull().state === 'open'}>
          <div class="pr-actions">
            <Show when={!props.pull().autoMergeEnabled}>
              <select class="repo-select" value={props.mergeMethod()} onChange={(e) => props.setMergeMethod(e.currentTarget.value)}>
                <option value="squash">squash</option><option value="merge">merge</option><option value="rebase">rebase</option>
              </select>
            </Show>
            <Show when={props.pull().autoMergeEnabled}><button type="button" onClick={() => props.run(props.disableAutoMerge.run())} disabled={props.disableAutoMerge.pending}>Disable auto-merge</button></Show>
            <Show when={!props.pull().autoMergeEnabled && props.pull().mergeStateStatus === 'BLOCKED'}><button type="button" onClick={() => props.run(props.enableAutoMerge.run())} disabled={props.enableAutoMerge.pending}>Enable auto-merge ({props.mergeMethod()})</button></Show>
            <Show when={!props.pull().autoMergeEnabled && props.pull().mergeStateStatus !== 'BLOCKED'}>
              <button type="button" onClick={() => props.run(props.merge.run())} disabled={props.merge.pending || props.pull().mergeable === 'CONFLICTING'} title={props.pull().mergeable === 'CONFLICTING' ? 'Resolve merge conflicts before merging' : undefined}>Merge</button>
            </Show>
            <button type="button" onClick={() => props.run(props.close.run())} disabled={props.close.pending}>Close</button>
            <button type="button" onClick={() => props.run(props.draft.run(!props.pull().draft))} disabled={props.draft.pending}>{props.pull().draft ? 'Ready for review' : 'Convert to draft'}</button>
          </div>
        </Show>
        <Show when={props.pull().state === 'closed'}><div class="pr-actions"><button type="button" onClick={() => props.run(props.reopen.run())} disabled={props.reopen.pending}>Reopen</button></div></Show>
        <Show when={props.actionError()}><div class="action-error">{props.actionError()}</div></Show>
      </div>

      <Show when={props.conflicting}>
        <details class="nav-section" open ref={props.conflictsRef}>
          <summary>Merge conflicts <Show when={props.conflicts()?.available && props.conflicts()!.files.length}><span class="muted"> ({props.conflicts()!.files.length})</span></Show></summary>
          <Show when={props.conflicts()?.available} fallback={<p class="muted" style={{ padding: '4px var(--pane-pad)' }}>{props.conflictsLoading() ? 'Checking for conflicting files…' : 'This PR has merge conflicts. Map this repo to a local checkout to list the conflicting files.'}</p>}>
            <ul class="file-list">
              <For each={props.conflicts()!.files} fallback={<li class="placeholder">Conflicts reported, but no specific files were detected.</li>}>
                {(path) => <li class="file-row"><button type="button" class="file-open" onClick={() => props.selectFile(path)}><span class="file-status file-status-warn" title="Conflicting">!</span><span class="file-path">{path}</span></button></li>}
              </For>
            </ul>
          </Show>
        </details>
      </Show>
    </>
  )
}
