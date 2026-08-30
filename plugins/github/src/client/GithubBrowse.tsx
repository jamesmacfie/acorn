// The GitHub browse surface behind the `github` rail Source (docs/github-integration.md § Reads and
// writes).
//
// Two splits, one inside the other: the pull list beside everything else, and inside that the
// navigator beside the diff. The host draws both, and the three hand-drawn `.pane-left` /
// `.pane-mid` / `.pane-right` sections that used to be here are gone with them.
//
// Params-driven, like the components it hosts: PullList reads `useParams()` itself, and the routes
// exist only to populate params. That is why this component takes no props for three columns.
//
// The routed project is all this surface needs to render, the same gate every other Source applies
// (plugins/http HttpBrowse). None of this plugin's own routes has to match (docs/plugins.md § Frame
// authoring and the UI kit): the routes address a pull, they do not decide whether the surface
// renders.
import { createSignal, lazy, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { forceRefreshPull } from './queries'
import { filesKey, pullKey, pullsKey, pullsRoute, pullsPrefixKey, type Pull } from '../shared/api'
import { projectsOptions, readJson } from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import PullList from './PullList'
import { githubCreateRoute } from './clientRoutes'
import { Button, DetailColumn, EmptyState, ListColumn, ListDetail, SectionHeader } from '@acorn/plugin-api/ui'

// Heavy surfaces stay behind their navigation intent so Shiki, diff rendering and the create-pull
// form do not compete with the first interactive paint. PullList is the startup path, so it loads
// eagerly.
const PullDetail = lazy(() => import('./PullDetail'))
const CreatePullForm = lazy(() => import('./CreatePullForm'))
const ComparePreview = lazy(() => import('./ComparePreview'))
const DiffView = lazy(() => import('./DiffView'))

export default function GithubBrowse() {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const owner = () => project()?.github?.owner ?? ''
  const repo = () => project()?.github?.name ?? ''
  // Pull requests need the GitHub facet, not only a project. A project with no github.com remote has
  // no pulls to list, and without this gate PullList sits on "Loading…" forever, because its queries
  // never enable.
  const linked = () => !!project()?.github
  // Create mode: the static route is contributed ahead of the parameter route.
  const newMatch = useMatch(() => githubCreateRoute)
  const isNew = () => !!newMatch()

  // Why the routed project is missing. `undefined` while the projects query is in flight, so the
  // first paint shows the mark rather than flashing "select a project".
  const emptyMessage = () => {
    if (!projects.data) return undefined
    const selected = project()
    if (!selected) return 'Select a project from the project menu to browse pull requests.'
    return `${selected.name} has no GitHub remote.`
  }

  const [refreshingPulls, setRefreshingPulls] = createSignal(false)
  const [refreshingPull, setRefreshingPull] = createSignal(false)

  async function refreshAllPulls() {
    if (!owner() || !repo()) return
    setRefreshingPulls(true)
    try {
      const data = await readJson<Pull[]>(`${pullsRoute(owner(), repo(), 'open')}&force=true`)
      queryClient.setQueryData(pullsKey(owner(), repo(), 'open'), data)
    } finally {
      setRefreshingPulls(false)
    }
  }

  async function refreshCurrentPull() {
    if (!owner() || !repo() || !params.number) return
    setRefreshingPull(true)
    try {
      const { detail, files } = await forceRefreshPull(owner(), repo(), params.number)
      queryClient.setQueryData(pullKey(owner(), repo(), params.number), detail)
      queryClient.setQueryData(filesKey(owner(), repo(), params.number), files)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pullsPrefixKey(owner(), repo()) }),
        // Linked tickets, both list enrichment and any open detail, refetch too. Keyed by string
        // rather than by importing the plugin that supplies them, so a force-refresh of a pull does
        // not make this plugin depend on whichever providers enrich it. The host's one prefix covers
        // every provider (client-core/host/registries/panes/refResolvers.ts).
        queryClient.invalidateQueries({ queryKey: ['plugin-ref-resolutions'] }),
      ])
    } finally {
      setRefreshingPull(false)
    }
  }

  return (
    <Show
      when={linked()}
      fallback={
        <Show when={emptyMessage()} fallback={<Acorn />}>
          {(message) => <EmptyState align="start">{message()}</EmptyState>}
        </Show>
      }
    >
      <ListDetail split>
        <ListColumn label="Reviews">
          <SectionHeader
            actions={
              <>
                <Button
                  tip="New pull request"
                  onPress={() => navigate(githubCreateRoute.replace(':projectId', encodeURIComponent(params.projectId ?? '')))}
                >+ New PR</Button>
                <Button variant="bare" iconOnly tip="Refresh reviews" label="Refresh reviews" busy={refreshingPulls()} onPress={refreshAllPulls}>↻</Button>
              </>
            }
          >
            Reviews
          </SectionHeader>
          <PullList />
        </ListColumn>
        <DetailColumn>
          <Show
            when={isNew()}
            fallback={
              <Show when={params.number} fallback={<Acorn />}>
                <ListDetail split listWidth="wide">
                  {/* No "Navigator" header: the tree under it opens with the pull's own heading,
                      which names the column better than a label ever did. */}
                  <ListColumn scroll label="Pull request">
                    <PullDetail />
                  </ListColumn>
                  <DetailColumn>
                    <SectionHeader
                      actions={
                        <Button variant="bare" iconOnly tip="Refresh diff" label="Refresh diff" busy={refreshingPull()} onPress={refreshCurrentPull}>↻</Button>
                      }
                    >
                      Diff
                    </SectionHeader>
                    <DiffView />
                  </DetailColumn>
                </ListDetail>
              </Show>
            }
          >
            <ListDetail split listWidth="wide">
              <ListColumn scroll label="New pull request">
                <SectionHeader>New pull request</SectionHeader>
                <CreatePullForm />
              </ListColumn>
              <DetailColumn>
                <SectionHeader>Compare</SectionHeader>
                <ComparePreview />
              </DetailColumn>
            </ListDetail>
          </Show>
        </DetailColumn>
      </ListDetail>
    </Show>
  )
}
