import { createEffect, createMemo, on, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { activeNodeId, setSelectedSource } from '@acorn/plugin-api/client'
import { Button, Stack } from '@acorn/plugin-api/ui'
import { createHistoryModel } from './historyModel'
import { HistoryRows } from './HistoryRows'
import { RevisionView } from './RevisionView'
import { WorktreeDetail, WorktreeList } from './WorktreeBrowse'
import { StashSourceDetail, StashSourceList } from './StashBrowse'

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
  const worktrees = () => !!base() || !!entry()
  const stashes = () => !!stashBase() || !!stashEntry()
  return <Stack gap="section">
    <Button variant={worktrees() || stashes() ? 'ghost' : 'solid'} onPress={() => navigate(path(params.projectId))}>History</Button>
    <Button variant={stashes() ? 'solid' : 'ghost'} onPress={() => navigate(`/p/${encodeURIComponent(params.projectId)}/x/git/stashes`)}>Stashes</Button>
    <Button variant={worktrees() ? 'solid' : 'ghost'} onPress={() => navigate(`/p/${encodeURIComponent(params.projectId)}/x/git/worktrees`)}>Worktrees</Button>
    <Show when={stashes()} fallback={<Show when={worktrees()} fallback={<HistoryList />}><WorktreeList /></Show>}><StashSourceList /></Show>
  </Stack>
}

export function GitSourceDetail() {
  const params = useParams<{ projectId: string; commitId?: string; worktreeId?: string }>()
  const navigate = useNavigate()
  const base = useMatch(() => '/p/:projectId/x/git/worktrees')
  const entry = useMatch(() => '/p/:projectId/x/git/worktrees/:worktreeId')
  const stashBase = useMatch(() => '/p/:projectId/x/git/stashes')
  const stashEntry = useMatch(() => '/p/:projectId/x/git/stashes/:stashId')
  const worktrees = () => !!base() || !!entry()
  const stashes = () => !!stashBase() || !!stashEntry()
  return <Show when={stashes()} fallback={<Show when={worktrees()} fallback={<RevisionView projectId={params.projectId} id={params.commitId ?? null}
    onCommit={(id) => { setSelectedSource('git'); navigate(path(params.projectId, id)) }} />}><WorktreeDetail /></Show>}><StashSourceDetail /></Show>
}
