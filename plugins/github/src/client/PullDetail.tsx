import { createMemo, createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'
import { EmptyState, IconButton, Sections } from '@acorn/plugin-api/ui'
import { useChangedFiles } from './changedFiles'
import { makeContentLinkHandler } from './contentLinks'
import { requestFileScroll, routeKey } from './fileNavigation'
import { fileSummariesKey, pullDiffKey, pullKey, pullsPrefixKey } from '../shared/api'
import { forceRefreshPull } from './queries'
import ChecksPanel from './checks/ChecksPanel'
import { DiffForPull, type PullRoute } from './DiffForPull'
import { prModel } from './pullDetail/prModel'
import { PrOverview } from './pullDetail/PrOverview'
import { prSections } from './pullDetail/prSections'

// One pull request, on the browse surface: the whole thing, and not half of it.
//
// It used to be the navigator column alone, with `GithubBrowse` writing the split and the diff column
// around it. The split is the `Sections` node's now, so the surface that knows what a pull request is
// made of is the one that says so, and the host decides whether that is folds beside a diff or a
// strip of tabs (docs/ui-design/closed-kit.md § The closed kit). ./pullDetail/PrPane.tsx makes the same call
// from a task.
export default function PullDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const owner = () => project()?.github?.owner ?? ''
  const repo = () => project()?.github?.name ?? ''
  const number = () => params.number ?? ''
  const ready = () => !!owner() && !!repo() && !!number()
  const [refreshing, setRefreshing] = createSignal(false)

  const model = createMemo(() => (ready() ? prModel({ owner: owner(), repo: repo(), number: number() }) : null))
  // Browse owns a route, so the selected file is `?file=` and the diff column reads it back.
  const changedFiles = useChangedFiles(() => (ready() ? { owner: owner(), repo: repo(), number: number() } : null))
  const selectFile = (path: string) => {
    changedFiles.selectFile(path)
    requestFileScroll({ routeKey: routeKey(owner(), repo(), number()), path })
  }
  const onLinkClick = makeContentLinkHandler(navigate)
  // Keyed, because `DiffForPull` reads its route once and `Sections` renders the diff once. Without a
  // new mount per pull, picking #44 after #42 left #42's diff on screen.
  const diffRoute = createMemo<PullRoute | null>(
    () => (ready() ? { owner: owner(), repo: repo(), number: number(), key: routeKey(owner(), repo(), number()) } : null),
    null,
    { equals: (a, b) => a?.key === b?.key },
  )

  // The pull and its files again from the source, and every ticket anything linked off them. Here
  // rather than on the browse region because it is this pull's own verb, and the only surface that
  // can offer it is the one drawing the pull.
  async function refresh() {
    if (!ready()) return
    setRefreshing(true)
    try {
      const { detail, diff } = await forceRefreshPull(owner(), repo(), number())
      queryClient.setQueryData(pullKey(owner(), repo(), number()), detail)
      queryClient.setQueryData(pullDiffKey(owner(), repo(), number()), diff)
      await Promise.all([
        // The file list reads summaries of the mirror that refresh just rewrote.
        queryClient.invalidateQueries({ queryKey: fileSummariesKey(owner(), repo(), number()) }),
        queryClient.invalidateQueries({ queryKey: pullsPrefixKey(owner(), repo()) }),
        // Linked tickets, both list enrichment and any open detail, refetch too. Keyed by string
        // rather than by importing the plugin that supplies them, so a force-refresh of a pull does
        // not make this plugin depend on whichever providers enrich it. The host's one prefix covers
        // every provider (client-core/host/registries/panes/refResolvers.ts).
        queryClient.invalidateQueries({ queryKey: ['plugin-ref-resolutions'] }),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Show when={number()} fallback={<EmptyState title="Choose a pull request" />}>
      <Show when={ready() || !projects.data} fallback={<EmptyState title={`Couldn't find pull request #${number()}`} />}>
        <Show when={model()} fallback={<EmptyState align="start" size="sm" busy>Loading…</EmptyState>}>
          {(loaded) => (
            <Show
              when={loaded().pull()}
              fallback={
                <EmptyState align="start" busy={!loaded().detail.isError}>
                  {loaded().detail.isError ? 'Not found.' : 'Loading…'}
                </EmptyState>
              }
            >
              <Sections
                id="github.pull"
                ariaLabel="Pull request"
                header={{
                  id: 'details',
                  label: 'Details',
                  render: () => <PrOverview model={loaded()} onOpenFile={selectFile} onLinkClick={onLinkClick} />,
                }}
                sections={prSections({
                  model: loaded(),
                  currentFile: changedFiles.currentFile,
                  onOpenFile: selectFile,
                  onLinkClick,
                })}
                main={{
                  id: 'diff',
                  label: 'Diff',
                  actions: () => (
                    <IconButton icon="refresh-cw" tip="Refresh pull request" label="Refresh pull request" busy={refreshing()} onPress={() => void refresh()} />
                  ),
                  render: () => (
                    <Show when={diffRoute()} keyed>{(route) => <DiffForPull route={route} router />}</Show>
                  ),
                }}
              />
              {/* The one overlay this surface owns: a run's step log, opened from a check row. */}
              <Show when={loaded().openCheck()}>
                {(check) => (
                  <ChecksPanel
                    owner={owner()}
                    repo={repo()}
                    runId={check().runId}
                    jobName={check().name}
                    url={check().url}
                    onClose={() => loaded().setOpenCheck(null)}
                  />
                )}
              </Show>
              {/* No reference panel here. The shell owns both the registry and the invocation
                  (client-core/host/registries/panes/refPanels.ts and refPanelHost.tsx), so this only asks. */}
            </Show>
          )}
        </Show>
      </Show>
    </Show>
  )
}
