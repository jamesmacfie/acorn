import { createMemo, createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'
import { Button, EmptyState, Sections } from '@acorn/plugin-api/ui'
import { useChangedFiles } from './changedFiles'
import { makeContentLinkHandler } from './contentLinks'
import { requestFileScroll, routeKey } from './fileNavigation'
import { filesKey, pullKey, pullsPrefixKey } from '../shared/api'
import { forceRefreshPull } from './queries'
import ChecksPanel from './checks/ChecksPanel'
import { DiffForPull } from './DiffForPull'
import { prModel } from './pullDetail/prModel'
import { PrOverview } from './pullDetail/PrOverview'
import { prSections } from './pullDetail/prSections'

// One pull request, on the browse surface: the whole thing, and not half of it.
//
// It used to be the navigator column alone, with `GithubBrowse` writing the split and the diff column
// around it. The split is the `Sections` node's now, so the surface that knows what a pull request is
// made of is the one that says so, and the host decides whether that is folds beside a diff or a
// strip of tabs (docs/ui-design.md § The closed kit). ./pullDetail/PrPane.tsx makes the same call
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

  // The pull and its files again from the source, and every ticket anything linked off them. Here
  // rather than on the browse region because it is this pull's own verb, and the only surface that
  // can offer it is the one drawing the pull.
  async function refresh() {
    if (!ready()) return
    setRefreshing(true)
    try {
      const { detail, files } = await forceRefreshPull(owner(), repo(), number())
      queryClient.setQueryData(pullKey(owner(), repo(), number()), detail)
      queryClient.setQueryData(filesKey(owner(), repo(), number()), files)
      await Promise.all([
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
    <Show when={number()} fallback={<EmptyState align="start">Select a PR.</EmptyState>}>
      <Show when={ready() || !projects.data} fallback={<EmptyState align="start">Not found.</EmptyState>}>
        <Show when={model()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
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
                    <Button variant="bare" iconOnly tip="Refresh diff" label="Refresh diff" busy={refreshing()} onPress={() => void refresh()}>↻</Button>
                  ),
                  render: () => (
                    <DiffForPull
                      route={{ owner: owner(), repo: repo(), number: number(), key: routeKey(owner(), repo(), number()) }}
                      router
                    />
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
