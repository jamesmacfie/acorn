import { createMemo, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'
import { EmptyState } from '@acorn/plugin-api/ui'
import { ChangeRequestView } from '@acorn/change-request-ui/views'
import { usePullChangedFiles } from './changedFiles'
import { makeContentLinkHandler } from './contentLinks'
import { requestFileScroll, routeKey } from './fileNavigation'
import GithubChecksPanel from './checks/GithubChecksPanel'
import { DiffForPull, type PullRoute } from './DiffForPull'
import { prModel } from './pullDetail/prModel'
import { RefreshPullButton } from './pullDetail/RefreshPullButton'

// One pull request, on the browse surface: the navigator and the diff together, drawn by the shared
// change request view. `PrPane` draws the same view from a task.
export default function PullDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const owner = () => project()?.github?.owner ?? ''
  const repo = () => project()?.github?.name ?? ''
  const number = () => params.number ?? ''
  const ready = () => !!owner() && !!repo() && !!number()

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
                diffActions={() => <RefreshPullButton owner={owner()} repo={repo()} number={number()} />}
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
