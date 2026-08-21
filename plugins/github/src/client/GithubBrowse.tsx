// The GitHub browse surface: the three-pane review layout behind the `github` rail Source
// (docs/github-integration.md § Reads and writes covers why its layout is pinned by e2e).
//
// Params-driven, like the components it hosts: PullList reads `useParams()` itself, and the routes
// exist only to populate params. That is why this component takes no props even though it renders
// three panes.
//
// The routed project is the only thing this surface needs to render, the same gate every other
// Source applies (plugins/http HttpBrowse). It does not require one of this plugin's own routes to
// match (docs/plugins.md § Frame authoring and the UI kit): the routes address a PR, they do not
// decide whether the surface renders.
import { createSignal, lazy, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { forceRefreshPull } from './queries'
import { filesKey, pullKey, pullsKey, pullsRoute, pullsPrefixKey, type Pull } from '../contract/api'
import { projectsOptions, readJson } from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import PullList from './PullList'
import { githubCreateRoute } from './routes'
import { Button, EmptyState, SectionHeader } from '@acorn/plugin-api/ui'

// Heavy/conditional surfaces stay behind their actual navigation intent so Shiki/diff rendering and
// the create-PR form do not compete with the first interactive paint. PullList is the startup path
// and loads eagerly.
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
  // Pull requests need the GitHub facet, not just a project: a project with no github.com remote has no
  // PRs to list, and without this gate PullList sits on "Loading…" forever (its queries never enable).
  const linked = () => !!project()?.github
  // Create-PR mode: the static route is contributed ahead of the parameter route.
  const newMatch = useMatch(() => githubCreateRoute)
  const isNew = () => !!newMatch()

  // Why the routed project is missing, said plainly. `undefined` while the projects query is in flight,
  // so the first paint shows the mark rather than flashing "select a project".
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
        // Linked tickets (list enrichment and any open detail), refetched too. Keyed by string
        // rather than by importing the plugin that supplies them, so a force-refresh of a PR does
        // not make this plugin depend on whichever providers enrich it.
        //
        // One prefix, the host's, covers every provider at once
        // (client-core/registries/refResolvers.ts).
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
        <main class="panes panes-empty">
          <Show when={emptyMessage()} fallback={<Acorn />}>
            {(message) => <EmptyState align="start">{message()}</EmptyState>}
          </Show>
        </main>
      }
    >
      <main class="panes">
        <section class="pane pane-left">
          <SectionHeader
            actions={
              <>
                <Button class="new-pr-btn" data-tip="New pull request" onClick={() => navigate(githubCreateRoute.replace(':projectId', encodeURIComponent(params.projectId ?? '')))}>
                  + New PR
                </Button>
                {/* Was a literal '...' with no accessible name for the busy state. */}
                <Button variant="bare" iconOnly data-tip="Refresh reviews" aria-label="Refresh reviews" busy={refreshingPulls()} onClick={refreshAllPulls}>↻</Button>
              </>
            }
          >
            Reviews
          </SectionHeader>
          <PullList />
        </section>
        <Show
          when={isNew()}
          fallback={
            <Show
              when={params.number}
              fallback={
                <section class="pane pane-mid pane-empty" style={{ 'grid-column': '2 / -1' }}>
                  <Acorn />
                </section>
              }
            >
              <section class="pane pane-mid">
                <SectionHeader>Navigator</SectionHeader>
                <PullDetail />
              </section>
              <section class="pane pane-right">
                <SectionHeader
                  actions={
                    <Button variant="bare" iconOnly title="Refresh diff" aria-label="Refresh diff" busy={refreshingPull()} onClick={refreshCurrentPull}>↻</Button>
                  }
                >
                  Diff
                </SectionHeader>
                <DiffView />
              </section>
            </Show>
          }
        >
          <section class="pane pane-mid">
            <div class="section-header">New pull request</div>
            <CreatePullForm />
          </section>
          <section class="pane pane-right">
            <div class="section-header">Compare</div>
            <ComparePreview />
          </section>
        </Show>
      </main>
    </Show>
  )
}
