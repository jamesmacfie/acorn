import { createEffect, createMemo, on, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { activeNodeId, setSelectedSource } from '@acorn/plugin-api/client'
import { Stack, TabPanel, Tabs } from '@acorn/plugin-api/ui'
import { createHistoryModel } from './historyModel'
import { HistoryRows } from './HistoryRows'
import { RevisionView } from './RevisionView'
import { WorktreeDetail, WorktreeList } from './WorktreeBrowse'
import { StashSourceDetail, StashSourceList } from './StashBrowse'
import { RefSourceDetail, RefSourceList } from './RefBrowse'
import { RemoteSourceDetail, RemoteSourceList } from './RemoteBrowse'
import { CompareSourceDetail, CompareSourceList } from './CompareBrowse'

const path = (projectId: string, id?: string) => `/p/${encodeURIComponent(projectId)}/x/git/history${id ? `/${id}` : ''}`

function HistoryList() {
  const params = useParams<{ projectId: string; commitId?: string }>()
  const navigate = useNavigate()
  const model = createHistoryModel(() => params.projectId ?? '', () => null)
  const scope = createMemo(() => `${activeNodeId()}:${params.projectId}`)
  createEffect(on(scope, () => { if (params.commitId) navigate(path(params.projectId)) }, { defer: true }))
  createEffect(on(() => JSON.stringify(model.filter()), () => { if (params.commitId) navigate(path(params.projectId)) }, { defer: true }))
  return <HistoryRows projectId={params.projectId} model={model} selected={params.commitId ?? null}
    onSelect={(id) => navigate(path(params.projectId, id))} />
}

export function GitSourceList() {
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
  const section = () => compare() ? 'compare' : remotes() ? 'remotes' : refs() ? 'refs' : stashes() ? 'stashes' : worktrees() ? 'worktrees' : 'history'
  const sectionPath = (id: string) => `/p/${encodeURIComponent(params.projectId)}/x/git/${id}`
  return <Stack gap="section" grow>
    <Tabs idPrefix={`git-sections-${params.projectId}`} ariaLabel="Git sections" active={section()} onChange={(id) => navigate(sectionPath(id))}
      tabs={[{ id: 'history', label: 'History' }, { id: 'stashes', label: 'Stashes' }, { id: 'worktrees', label: 'Worktrees' },
        { id: 'refs', label: 'Refs' }, { id: 'remotes', label: 'Remotes' }, { id: 'compare', label: 'Compare' }]} />
    <TabPanel idPrefix={`git-sections-${params.projectId}`} id={section()} active={section()}>
      <Show when={compare()} fallback={<Show when={remotes()} fallback={<Show when={refs()} fallback={<Show when={stashes()} fallback={<Show when={worktrees()} fallback={<HistoryList />}><WorktreeList /></Show>}><StashSourceList /></Show>}><RefSourceList /></Show>}><RemoteSourceList /></Show>}><CompareSourceList /></Show>
    </TabPanel>
  </Stack>
}

export function GitSourceDetail() {
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
  return <Show when={compare()} fallback={<Show when={remotes()} fallback={<Show when={refs()} fallback={<Show when={stashes()} fallback={<Show when={worktrees()} fallback={<RevisionView projectId={params.projectId} id={params.commitId ?? null}
    onCommit={(id) => { setSelectedSource('git'); navigate(path(params.projectId, id)) }} />}><WorktreeDetail /></Show>}><StashSourceDetail /></Show>}><RefSourceDetail /></Show>}><RemoteSourceDetail /></Show>}><CompareSourceDetail /></Show>
}
