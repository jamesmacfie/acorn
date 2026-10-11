import { createEffect, createMemo, on, onCleanup, Show, untrack } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { useLocation, useMatch, useNavigate, useParams } from '@solidjs/router'
import { activeNodeId, setSelectedSource, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'
import { Stack, Tabs } from '@acorn/plugin-api/ui'
import { createHistoryModel } from './historyModel'
import { HistoryRows } from './HistoryRows'
import { RevisionView } from './RevisionView'
import { WorktreeDetail, WorktreeList } from './WorktreeBrowse'
import { StashSourceDetail, StashSourceList } from './StashBrowse'
import { RefSourceDetail, RefSourceList } from './RefBrowse'
import { RemoteSourceDetail, RemoteSourceList } from './RemoteBrowse'
import { CompareSourceDetail, CompareSourceList } from './CompareBrowse'
import { createGitViewSignal } from './viewState'
import { GitScrollPanel } from './GitScrollPanel'

const path = (projectId: string, id?: string) =>
  `/p/${encodeURIComponent(projectId)}/x/git/history${id ? `/${id}` : ''}`

function HistoryList() {
  const params = useParams<{ projectId: string; commitId?: string }>()
  const navigate = useNavigate()
  const model = createHistoryModel(
    () => params.projectId ?? '',
    () => null,
  )
  const scope = createMemo(() => `${activeNodeId()}:${params.projectId}`)
  createEffect(
    on(
      scope,
      () => {
        if (params.commitId) navigate(path(params.projectId))
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => JSON.stringify(model.filter()),
      () => {
        if (params.commitId) navigate(path(params.projectId))
      },
      { defer: true },
    ),
  )
  return (
    <HistoryRows
      projectId={params.projectId}
      model={model}
      selected={params.commitId ?? null}
      onSelect={(id) => navigate(path(params.projectId, id))}
    />
  )
}

export function GitSourceList() {
  const params = useParams<{ projectId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [lastPath, setLastPath] = createGitViewSignal(
    () => params.projectId,
    () => 'source:path',
    () => path(params.projectId),
  )
  createEffect(
    on(
      () => [activeNodeId(), params.projectId, location.pathname] as const,
      ([node, project, current], previous) => {
        if (!project) return
        if (previous && node !== previous[0] && current === previous[2]) {
          navigate(untrack(lastPath), { replace: true })
          return
        }
        const prefix = `/p/${encodeURIComponent(project)}/x/git/`
        if (current.startsWith(prefix)) setLastPath(current)
        else navigate(untrack(lastPath), { replace: true })
      },
    ),
  )
  return (
    <Show keyed when={JSON.stringify([activeNodeId(), params.projectId])}>
      {(_scope) => <GitProjectList />}
    </Show>
  )
}

function GitProjectList() {
  const params = useParams<{ projectId: string; commitId?: string; worktreeId?: string }>()
  const cache = useQueryClient()
  const refresh = () => {
    const node = activeNodeId(),
      project = params.projectId
    for (const prefix of ['git-history', 'git-refs', 'git-remotes'])
      void cache.invalidateQueries({ queryKey: [prefix, node, project] })
  }
  const off = [wsOnNodeEvent('worktree:status-changed', refresh), wsOnReconnect(refresh)]
  onCleanup(() => off.forEach((dispose) => dispose()))
  const navigate = useNavigate()
  const base = useMatch(() => '/p/:projectId/x/git/worktrees')
  const entry = useMatch(() => '/p/:projectId/x/git/worktrees/:worktreeId')
  const stashBase = useMatch(() => '/p/:projectId/x/git/stashes')
  const stashEntry = useMatch(() => '/p/:projectId/x/git/stashes/:stashId')
  const refsBase = useMatch(() => '/p/:projectId/x/git/refs')
  const refsEntry = useMatch(() => '/p/:projectId/x/git/refs/:refId')
  const remotesBase = useMatch(() => '/p/:projectId/x/git/remotes')
  const remotesEntry = useMatch(() => '/p/:projectId/x/git/remotes/:remoteName')
  const compareBase = useMatch(() => '/p/:projectId/x/git/compare')
  const compareEntry = useMatch(() => '/p/:projectId/x/git/compare/:source/:destination/:mode/:base')
  const worktrees = () => !!base() || !!entry()
  const stashes = () => !!stashBase() || !!stashEntry()
  const refs = () => !!refsBase() || !!refsEntry()
  const remotes = () => !!remotesBase() || !!remotesEntry()
  const compare = () => !!compareBase() || !!compareEntry()
  const section = () =>
    compare()
      ? 'compare'
      : remotes()
        ? 'remotes'
        : refs()
          ? 'refs'
          : stashes()
            ? 'stashes'
            : worktrees()
              ? 'worktrees'
              : 'history'
  const sectionPath = (id: string) => `/p/${encodeURIComponent(params.projectId)}/x/git/${id}`
  const [sectionPaths, setSectionPaths] = createGitViewSignal<Record<string, string>>(
    () => params.projectId,
    () => 'source:sections',
    () => ({}),
  )
  const location = useLocation()
  createEffect(() => {
    const current = location.pathname
    if (current.startsWith(`/p/${encodeURIComponent(params.projectId)}/x/git/`)) {
      setSectionPaths((previous) =>
        previous[section()] === current ? previous : { ...previous, [section()]: current },
      )
    }
  })
  return (
    <Stack gap="none" grow>
      <Tabs
        idPrefix={`git-sections-${activeNodeId()}-${params.projectId}`}
        ariaLabel="Git sections"
        active={section()}
        onChange={(id) => navigate(sectionPaths()[id] ?? sectionPath(id))}
        tabs={[
          { id: 'history', label: 'History' },
          { id: 'stashes', label: 'Stashes' },
          { id: 'worktrees', label: 'Worktrees' },
          { id: 'refs', label: 'Refs' },
          { id: 'remotes', label: 'Remotes' },
          { id: 'compare', label: 'Compare' },
        ]}
      />
      <Show keyed when={section()}>
        {(tab) => (
          <GitScrollPanel
            projectId={params.projectId}
            name={`list:${tab}`}
            idPrefix={`git-sections-${activeNodeId()}-${params.projectId}`}
            id={tab}
          >
            <Show
              when={compare()}
              fallback={
                <Show
                  when={remotes()}
                  fallback={
                    <Show
                      when={refs()}
                      fallback={
                        <Show
                          when={stashes()}
                          fallback={
                            <Show when={worktrees()} fallback={<HistoryList />}>
                              <WorktreeList />
                            </Show>
                          }
                        >
                          <StashSourceList />
                        </Show>
                      }
                    >
                      <RefSourceList />
                    </Show>
                  }
                >
                  <RemoteSourceList />
                </Show>
              }
            >
              <CompareSourceList />
            </Show>
          </GitScrollPanel>
        )}
      </Show>
    </Stack>
  )
}

export function GitSourceDetail() {
  const params = useParams<{ projectId: string }>()
  const location = useLocation()
  return (
    <Show keyed when={JSON.stringify([activeNodeId(), params.projectId, location.pathname])}>
      {(_scope) => (
        <GitScrollPanel
          projectId={params.projectId}
          name={`detail:${location.pathname}`}
          idPrefix={`git-detail-${activeNodeId()}-${params.projectId}`}
          id="detail"
        >
          <GitProjectDetail />
        </GitScrollPanel>
      )}
    </Show>
  )
}

function GitProjectDetail() {
  const params = useParams<{ projectId: string; commitId?: string; worktreeId?: string }>()
  const navigate = useNavigate()
  const base = useMatch(() => '/p/:projectId/x/git/worktrees')
  const entry = useMatch(() => '/p/:projectId/x/git/worktrees/:worktreeId')
  const stashBase = useMatch(() => '/p/:projectId/x/git/stashes')
  const stashEntry = useMatch(() => '/p/:projectId/x/git/stashes/:stashId')
  const refsBase = useMatch(() => '/p/:projectId/x/git/refs')
  const refsEntry = useMatch(() => '/p/:projectId/x/git/refs/:refId')
  const remotesBase = useMatch(() => '/p/:projectId/x/git/remotes')
  const remotesEntry = useMatch(() => '/p/:projectId/x/git/remotes/:remoteName')
  const compareBase = useMatch(() => '/p/:projectId/x/git/compare')
  const compareEntry = useMatch(() => '/p/:projectId/x/git/compare/:source/:destination/:mode/:base')
  const worktrees = () => !!base() || !!entry()
  const stashes = () => !!stashBase() || !!stashEntry()
  const refs = () => !!refsBase() || !!refsEntry()
  const remotes = () => !!remotesBase() || !!remotesEntry()
  const compare = () => !!compareBase() || !!compareEntry()
  return (
    <Show
      when={compare()}
      fallback={
        <Show
          when={remotes()}
          fallback={
            <Show
              when={refs()}
              fallback={
                <Show
                  when={stashes()}
                  fallback={
                    <Show
                      when={worktrees()}
                      fallback={
                        <RevisionView
                          projectId={params.projectId}
                          id={params.commitId ?? null}
                          onCommit={(id) => {
                            setSelectedSource('git')
                            navigate(path(params.projectId, id))
                          }}
                        />
                      }
                    >
                      <WorktreeDetail />
                    </Show>
                  }
                >
                  <StashSourceDetail />
                </Show>
              }
            >
              <RefSourceDetail />
            </Show>
          }
        >
          <RemoteSourceDetail />
        </Show>
      }
    >
      <CompareSourceDetail />
    </Show>
  )
}
