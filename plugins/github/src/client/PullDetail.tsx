import { createMemo, createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'
import { EmptyState, IconButton } from '@acorn/plugin-api/ui'
import { ChangeRequestView } from '@acorn/change-request-ui/views'
import { usePullChangedFiles } from './changedFiles'
import { makeContentLinkHandler } from './contentLinks'
import { requestFileScroll, routeKey } from './fileNavigation'
import { fileSummariesKey, pullDiffKey, pullKey, pullsPrefixKey } from '../shared/api'
import { forceRefreshPull } from './queries'
import GithubChecksPanel from './checks/GithubChecksPanel'
import { DiffForPull, type PullRoute } from './DiffForPull'
import { prModel } from './pullDetail/prModel'

// One pull request, on the browse surface: the navigator and the diff together, drawn by the shared
// change request view. `PrPane` draws the same view from a task.
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
  const changedFiles = usePullChangedFiles(() => (ready() ? { owner: owner(), repo: repo(), number: number() } : null))
  const selectFile = (path: string) => {
    changedFiles.selectFile(path)
    requestFileScroll({ routeKey: routeKey(owner(), repo(), number()), path })
  }
  const onLinkClick = makeContentLinkHandler(navigate)
  // Keyed, because `DiffForPull` reads its route once and `Sections` renders the diff once. Without a
  // new mount per pull, picking #44 after #42 would leave #42's diff on screen.
  const diffRoute = createMemo<PullRoute | null>(
    () =>
      ready() ? { owner: owner(), repo: repo(), number: number(), key: routeKey(owner(), repo(), number()) } : null,
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
        // every provider.
        queryClient.invalidateQueries({ queryKey: ['plugin-ref-resolutions'] }),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Show when={number()} fallback={<EmptyState title="Choose a pull request" />}>
      <Show
        when={ready() || !projects.data}
        fallback={<EmptyState title={`Couldn't find pull request #${number()}`} />}
      >
        <Show
          when={model()}
          fallback={
            <EmptyState align="start" size="sm" busy>
              Loading…
            </EmptyState>
          }
        >
          {(loaded) => (
            <Show
              when={loaded().request()}
              fallback={
                <EmptyState align="start" busy={!loaded().detailFailed()}>
                  {loaded().detailFailed() ? 'Not found.' : 'Loading…'}
                </EmptyState>
              }
            >
              <ChangeRequestView
                id="github.pull"
                model={loaded()}
                currentFile={changedFiles.currentFile}
                onOpenFile={selectFile}
                onLinkClick={onLinkClick}
                diffActions={() => (
                  <IconButton
                    icon="refresh-cw"
                    tip="Refresh pull request"
                    label="Refresh pull request"
                    busy={refreshing()}
                    onPress={() => void refresh()}
                  />
                )}
                diff={() => (
                  <Show when={diffRoute()} keyed>
                    {(route) => <DiffForPull route={route} router />}
                  </Show>
                )}
                checkPanel={(check, close) => (
                  <GithubChecksPanel owner={owner()} repo={repo()} check={check} onClose={close} />
                )}
              />
              {/* No reference panel here. The shell owns both the registry and the invocation
                  (client-core/host/registries/panes/refPanels.ts and refPanelHost.tsx), so this only asks. */}
            </Show>
          )}
        </Show>
      </Show>
    </Show>
  )
}
