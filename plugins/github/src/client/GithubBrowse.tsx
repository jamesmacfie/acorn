// The GitHub browse surface: the three-pane review layout behind the `github` rail Source.
//
// This was App.tsx's `<Switch>` FALLBACK — the shell rendered it inline, imported five of this plugin's
// components (PullList, PullDetail, DiffView, CreatePullForm, ComparePreview), and owned the two force-refresh
// handlers below. Every other Source already went through `sourceRegistry` + `<Dynamic>`; GitHub alone was
// special-cased, because `client-core/tabs/sources.ts` hardcoded it ahead of the registry.
//
// Nothing about the layout changed in the move. The panes, section headers, refresh buttons, the `+ New PR`
// affordance and the params-driven branching are carried over verbatim, because they are user-visible and
// pinned by the e2e suite.
//
// Params-driven, like the components it hosts: PullList reads `useParams()` itself, and the routes exist only
// to populate params. That is why this component takes no props even though it renders three panes.
//
// The routed project is the only thing this surface needs to render — the same gate every other Source
// applies (plugins/http HttpBrowse). It deliberately does NOT require one of this plugin's own routes to
// match: the rail selects a Source by signal and never navigates, so a route-match gate made the whole
// surface unreachable from anywhere except a PR link. The routes still exist, and still address a PR; they
// refine what is shown here rather than deciding whether anything is.
import { createSignal, lazy, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { forceRefreshPull } from './queries'
import { filesKey, pullKey, pullsKey, pullsRoute, pullsPrefixKey, type Pull } from '../contract/api'
import { projectsOptions, readJson } from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import PullList from './PullList'
import { githubCreateRoute } from './routes'

// Heavy/conditional surfaces stay behind their actual navigation intent so Shiki/diff rendering and the
// create-PR form do not compete with the first interactive paint. PullList is the startup path and is
// imported eagerly, exactly as it was when the shell owned this.
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
        // Linked tickets (list enrichment + any open detail) — refetch their status too. Keyed by
        // string, not by importing the plugin that supplies them: these are client-core query keys, and a
        // force-refresh of a PR should not make this plugin depend on whichever providers enrich it.
        //
        // One prefix, the HOST's, covering every provider at once
        // (client-core/registries/refResolvers.ts). The second line here used to be `['linear-issue']`,
        // a detail key that stopped existing when Linear became a frame — a frame calls its routes over
        // the bridge and keeps no query cache, so there was nothing left to invalidate.
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
            {(message) => <p class="placeholder">{message()}</p>}
          </Show>
        </main>
      }
    >
      <main class="panes">
        <section class="pane pane-left">
          <div class="section-header">
            Reviews
            <button type="button" class="new-pr-btn" title="New pull request" onClick={() => navigate(githubCreateRoute.replace(':projectId', encodeURIComponent(params.projectId ?? '')))}>
              + New PR
            </button>
            <button type="button" class="section-refresh" title="Refresh reviews" aria-label="Refresh reviews" disabled={refreshingPulls()} onClick={refreshAllPulls}>
              {refreshingPulls() ? '...' : '↻'}
            </button>
          </div>
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
                <div class="section-header">Navigator</div>
                <PullDetail />
              </section>
              <section class="pane pane-right">
                <div class="section-header">
                  Diff
                  <button type="button" class="section-refresh" style={{ 'margin-left': 'auto' }} title="Refresh diff" aria-label="Refresh diff" disabled={refreshingPull()} onClick={refreshCurrentPull}>
                    {refreshingPull() ? '...' : '↻'}
                  </button>
                </div>
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
