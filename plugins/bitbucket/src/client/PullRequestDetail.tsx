import { createMemo, createSignal, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { clientEvents, handlePluginContentLinkClick } from '@acorn/plugin-api/client'
import { EmptyState, IconButton } from '@acorn/plugin-api/ui'
import { ChangeRequestView, useChangedFiles } from '@acorn/change-request-ui/views'
import { diffKey, pullRequestKey, pullRequestsPrefixKey } from '../shared/api'
import { DiffForPullRequest, type PullRequestRoute } from './DiffForPullRequest'
import { createBrowseScope } from './browseScope'
import { splitRepository } from './clientRoutes'
import { forceRefresh } from './queries'
import { prModel } from './pullRequest/prModel'

// One pull request on the browse surface: the shared change request view, with `?file=` as the
// selected file because browse owns a route.
export default function PullRequestDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scope = createBrowseScope()
  const number = () => params.number ?? ''
  const ready = () => scope.linked() && !!number()
  const model = createMemo(() =>
    ready() ? prModel({ ...splitRepository(scope.repository()), number: number() }) : null,
  )
  const changedFiles = useChangedFiles(() => model()?.files() ?? [])
  // Keyed, because the diff reads its route once: a new pull request gets a new diff.
  const route = createMemo<PullRequestRoute | null>(
    () =>
      ready() ? { repository: scope.repository(), number: number(), key: `${scope.repository()}#${number()}` } : null,
    null,
    { equals: (a, b) => a?.key === b?.key },
  )
  const select = (path: string) => {
    changedFiles.selectFile(path)
    const key = route()?.key
    if (key) clientEvents.emit('presentation:file-scroll', { routeKey: key, path })
  }
  const onLinkClick = (event: MouseEvent) => handlePluginContentLinkClick(event, { prefer: 'refPanel', navigate })

  const [refreshing, setRefreshing] = createSignal(false)
  async function refresh() {
    const at = route()
    if (!at) return
    setRefreshing(true)
    try {
      const [detail, diff] = await forceRefresh(at.repository, at.number)
      queryClient.setQueryData(pullRequestKey(at.repository, at.number), detail)
      queryClient.setQueryData(diffKey(at.repository, at.number), diff)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pullRequestsPrefixKey(at.repository) }),
        queryClient.invalidateQueries({ queryKey: ['plugin-ref-resolutions'] }),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Show when={number()} fallback={<EmptyState title="Choose a pull request" />}>
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
              id="bitbucket.pull-request"
              model={loaded()}
              currentFile={changedFiles.currentFile}
              onOpenFile={select}
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
                <Show when={route()} keyed>
                  {(at) => <DiffForPullRequest route={at} router />}
                </Show>
              )}
            />
          </Show>
        )}
      </Show>
    </Show>
  )
}
