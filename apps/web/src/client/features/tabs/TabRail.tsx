import { createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, pullDetailOptions, workspacesKey, workspacesOptions, type Workspace } from '../../queries'
import { archiveWorkspace, createWorkspace, renameWorkspace } from '../../mutations'
import { checksState } from '../../displayMeta'
import { activeWorkspaceId, selectedSource, setActivePane, setActiveWorkspaceId, setSelectedSource, type SourceId } from '../workspaces/workspaces'
import { workspaceStatus } from '../workspaces/workspaceStatus'
import { terminalApi } from '../terminal/terminalClient'
import './tabrail.css'

// The Workspaces zone of the left rail (docs/workspaces P1/P2). Rows are real Workspace entities
// (not path bookmarks). Clicking a row makes it active and navigates to its repo/PR; clicking the
// active row opens a popover to rename or archive it. ponytail: create/rename use a small modal
// reusing the shared .overlay shell — the richer promotion flows (PR rows → workspace, local-first
// new branch) land in P3/P4. (Electron's BrowserWindow has no window.prompt, so we can't shortcut.)

// Origin → glyph; cosmetic, replaces the old cycled icon.
const ORIGIN_GLYPH: Record<Workspace['origin'], string> = { 'github-pr': '⌥', linear: '◷', rollbar: '◍', local: '●' }

type Draft = { mode: 'new' } | { mode: 'rename'; w: Workspace }

export default function TabRail() {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  const query = createQuery(() => workspacesOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))
  const [menuId, setMenuId] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal<Draft | null>(null)
  const [text, setText] = createSignal('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: workspacesKey })

  function pathFor(w: Workspace): string {
    return `/${w.repoOwner}/${w.repoName}${w.pullNumber != null ? `/${w.pullNumber}` : ''}`
  }

  // Sources: GitHub always, Linear when connected (docs/workspaces 04). Selecting one fills the
  // main area with that source's browse view.
  const sources = (): { id: SourceId; glyph: string; label: string }[] => [
    { id: 'github', glyph: '◇', label: 'GitHub' },
    ...(integrations.data?.linear.connected ? [{ id: 'linear' as const, glyph: '◷', label: 'Linear' }] : []),
  ]
  function selectSource(id: SourceId) {
    setMenuId(null)
    setSelectedSource(id)
  }

  function onRowClick(w: Workspace) {
    if (w.id === activeWorkspaceId() && !selectedSource()) {
      setMenuId((v) => (v === w.id ? null : w.id))
      return
    }
    setMenuId(null)
    setSelectedSource(null)
    setActiveWorkspaceId(w.id)
    setActivePane(w.pullNumber != null ? 'pr' : w.links.some((l) => l.provider === 'linear') ? 'linear' : 'pr')
    navigate(pathFor(w))
  }

  function openNew() {
    setMenuId(null)
    if (!params.owner || !params.repo) {
      window.alert('Open a repo first, then create a workspace for it.')
      return
    }
    setText('')
    setDraft({ mode: 'new' })
  }

  function openRename(w: Workspace) {
    setMenuId(null)
    setText(w.title)
    setDraft({ mode: 'rename', w })
  }

  async function submitDraft(e: Event) {
    e.preventDefault()
    const d = draft()
    const value = text().trim()
    if (!d || !value) return setDraft(null)
    if (d.mode === 'new') {
      const { owner, repo } = params
      if (!owner || !repo) return setDraft(null)
      const w = await createWorkspace({ origin: 'local', repoOwner: owner, repoName: repo, branch: value })
      await invalidate()
      setSelectedSource(null)
      setActiveWorkspaceId(w.id)
      setActivePane('pr')
      navigate(pathFor(w))
    } else if (value !== d.w.title) {
      await renameWorkspace(d.w.id, value)
      await invalidate()
    }
    setDraft(null)
  }

  // Archive runs through the guarded main-process teardown when on desktop (refuses while sessions
  // run or the worktree is dirty, removes the worktree); falls back to the plain HTTP flip otherwise.
  async function onArchive(w: Workspace) {
    setMenuId(null)
    if (!window.confirm(`Archive "${w.title}"?`)) return
    const api = terminalApi()
    if (api) {
      const res = await api.workspace.archive(w.id)
      if (!res.ok) return window.alert(res.reason)
    } else {
      await archiveWorkspace(w.id)
    }
    if (activeWorkspaceId() === w.id) {
      setActiveWorkspaceId(null)
      setSelectedSource('github') // archived the active workspace → fall back to the GitHub browse
    }
    await invalidate()
  }

  return (
    <nav class="tabrail">
      <div class="tabrail-zone tabrail-sources">
        <For each={sources()}>
          {(s) => (
            <button
              type="button"
              class="tabrail-tab tabrail-source"
              classList={{ active: selectedSource() === s.id }}
              title={s.label}
              onClick={() => selectSource(s.id)}
            >
              {s.glyph}
            </button>
          )}
        </For>
      </div>
      <div class="tabrail-sep" />
      <div class="tabrail-list">
        <For each={query.data ?? []}>
          {(w) => {
            // PR checks dot (warmed/fetched detail) and live worktree status (dirty / vanished).
            const detail = createQuery(() => pullDetailOptions(w.repoOwner, w.repoName, w.pullNumber != null ? String(w.pullNumber) : '', w.pullNumber != null))
            const checks = () => detail.data?.checks ?? []
            const st = () => workspaceStatus(w.id)
            return (
            <div class="tabrail-item">
              <button
                type="button"
                class="tabrail-tab"
                classList={{ active: !selectedSource() && w.id === activeWorkspaceId() }}
                title={w.title}
                onClick={() => onRowClick(w)}
              >
                {ORIGIN_GLYPH[w.origin] ?? '●'}
              </button>
              <Show when={w.pullNumber != null && checks().length}>
                <span class={`tabrail-checks checks-dot checks-dot-${checksState(checks())}`} title="PR checks" />
              </Show>
              <Show when={st()?.missing} fallback={
                <Show when={st()?.dirty}>
                  <span class="tabrail-dirty" title={`Uncommitted changes (${st()?.dirtyCount})`}>✎</span>
                </Show>
              }>
                <span class="tabrail-dirty tabrail-repair" title="Worktree missing — needs repair">⚠</span>
              </Show>
              <Show when={menuId() === w.id}>
                <div class="tabrail-menu">
                  <div class="tabrail-menu-title">{w.title}</div>
                  <button type="button" class="tabrail-close" onClick={() => openRename(w)}>
                    Rename
                  </button>
                  <button type="button" class="tabrail-close" onClick={() => void onArchive(w)}>
                    Archive
                  </button>
                </div>
              </Show>
            </div>
            )
          }}
        </For>
      </div>
      <button type="button" class="tabrail-add" title="New workspace" onClick={openNew}>
        +
      </button>
      <Show when={draft()}>
        {(d) => (
          <div class="overlay-backdrop" onClick={() => setDraft(null)}>
            <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div class="overlay-title">{d().mode === 'new' ? 'New workspace' : 'Rename workspace'}</div>
              <div class="overlay-body">
                <Show when={d().mode === 'new'}>
                  <p class="muted">A local-first workspace on a new branch in {params.owner}/{params.repo}.</p>
                </Show>
                <form class="integration-key-row" onSubmit={submitDraft}>
                  <input
                    class="integration-key-input"
                    type="text"
                    autofocus
                    placeholder={d().mode === 'new' ? 'feat/my-branch' : 'Workspace name'}
                    value={text()}
                    onInput={(e) => setText(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
                  />
                  <button type="submit" class="overlay-btn" disabled={!text().trim()}>
                    {d().mode === 'new' ? 'Create' : 'Save'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </Show>
    </nav>
  )
}
