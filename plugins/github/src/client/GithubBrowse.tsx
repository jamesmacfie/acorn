// The GitHub browse surface behind the `github` rail Source (docs/github-integration.md § Reads and
// writes), as two regions rather than one component.
//
// It used to be one `ListDetail split` here, with the pull list in one column and everything else in
// the other. That is still what the desktop draws — `SourceSurface` composes exactly this from the
// two exports below — but the columns are now named, because the terminal shell puts the list in a
// panel of its own down the left and the detail in the main panel, and no host can pull two columns
// apart from inside an opaque component (client-core § SourceContribution.regions).
//
// Params-driven, like the components it hosts: `PullList` reads `useParams()` itself, and the routes
// exist only to populate params. That is why neither export takes props.
//
// The routed project is all this surface needs to render, the same gate every other Source applies
// (plugins/http HttpBrowse). None of this plugin's own routes has to match (docs/plugins.md § Frame
// authoring and the UI kit): the routes address a pull, they do not decide whether the surface
// renders.
import { createSignal, lazy, Show, Suspense, type JSX } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { pullsKey, pullsRoute, type Pull } from '../shared/api'
import { readJson } from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import PullList from './PullList'
import { createBrowseScope } from './browseScope'
import { githubCreateRoute } from './clientRoutes'
import {
  Button, DetailColumn, EmptyState, IconButton, ListColumn, ListDetail, SectionHeader,
} from '@acorn/plugin-api/ui'

// Heavy surfaces stay behind their navigation intent so Shiki, diff rendering and the create-pull
// form do not compete with the first interactive paint. PullList is the startup path, so it loads
// eagerly.
const PullDetail = lazy(() => import('./PullDetail'))
const CreatePullForm = lazy(() => import('./CreatePullForm'))
const ComparePreview = lazy(() => import('./ComparePreview'))

/** The gate both regions share. Drawn once per region rather than once for the surface, because the
 *  two regions no longer have a common parent to put it on — and a list that renders while its detail
 *  says "no GitHub remote" is the disagreement `createBrowseScope` exists to prevent. */
function WhenLinked(props: { scope: ReturnType<typeof createBrowseScope>; children: JSX.Element }) {
  return (
    <Show when={props.scope.linked()} fallback={
      <Show when={props.scope.emptyMessage()} fallback={<Acorn />}>
        {(message) => <EmptyState align="start">{message()}</EmptyState>}
      </Show>
    }>
      {props.children}
    </Show>
  )
}

/** The `list` region: the pulls, with the new-PR and refresh actions that belong to the whole list. */
export function GithubBrowseList() {
  const scope = createBrowseScope()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = createSignal(false)

  async function refreshAllPulls() {
    if (!scope.owner() || !scope.repo()) return
    setRefreshing(true)
    try {
      const data = await readJson<Pull[]>(`${pullsRoute(scope.owner(), scope.repo(), 'open')}&force=true`)
      queryClient.setQueryData(pullsKey(scope.owner(), scope.repo(), 'open'), data)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <WhenLinked scope={scope}>
      <SectionHeader
        actions={
          <>
            <Button
              tip="New pull request"
              onPress={() => navigate(githubCreateRoute.replace(':projectId', encodeURIComponent(scope.projectId())))}
            >+ New PR</Button>
            <IconButton icon="refresh-cw" tip="Refresh reviews" label="Refresh reviews" busy={refreshing()} onPress={refreshAllPulls} />
          </>
        }
      >
        Reviews
      </SectionHeader>
      <PullList />
    </WhenLinked>
  )
}

/** The `detail` region: the pull that is open, or the create form. */
export function GithubBrowseDetail() {
  const scope = createBrowseScope()
  const params = useParams()
  // Create mode: the static route is contributed ahead of the parameter route.
  const newMatch = useMatch(() => githubCreateRoute)
  const isNew = () => !!newMatch()

  return (
    <WhenLinked scope={scope}>
      {/* A `Suspense` round each `lazy()` below, which is the ordinary thing to put round one: it is
          what decides what the region shows while a chunk is loading, on either host. They arrived as
          a workaround for a cell host refusing the empty string a pending `lazy()` resolves to, and
          they are no longer that — the terminal paints a loose string as a one-line run
          (docs/tui.md § Rendering). They stay because a boundary at a lazy mount is correct
          either way. */}
      <Show
        when={isNew()}
        fallback={
          <Show when={params.number} fallback={<Acorn />}>
            {/* No split written here any more. A pull request is a header, its sections and its diff,
                and `Sections` is the node that says so — so this region is the gate and `PullDetail`
                is the surface (client-core/kit/components/layout/Sections.tsx). */}
            <Suspense fallback={null}><PullDetail /></Suspense>
          </Show>
        }
      >
        <ListDetail split listWidth="wide">
          <ListColumn scroll label="New pull request">
            <SectionHeader>New pull request</SectionHeader>
            <Suspense fallback={null}><CreatePullForm /></Suspense>
          </ListColumn>
          <DetailColumn>
            <SectionHeader>Compare</SectionHeader>
            <Suspense fallback={null}><ComparePreview /></Suspense>
          </DetailColumn>
        </ListDetail>
      </Show>
    </WhenLinked>
  )
}
