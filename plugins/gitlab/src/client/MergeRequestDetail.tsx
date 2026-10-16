import { createMemo, createSignal, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { clientEvents, handlePluginContentLinkClick } from '@acorn/plugin-api/client'
import { EmptyState, IconButton } from '@acorn/plugin-api/ui'
import { ChangeRequestView, useChangedFiles } from '@acorn/change-request-ui/views'
import { diffKey, mergeRequestKey, mergeRequestsPrefixKey } from '../shared/api'
import { DiffForMergeRequest, type MergeRequestRoute } from './DiffForMergeRequest'
import GitlabChecksPanel from './GitlabChecksPanel'
import { createBrowseScope } from './browseScope'
import { splitPath } from './clientRoutes'
import { forceRefresh } from './queries'
import { mrModel } from './mergeRequest/mrModel'

// One merge request on the browse surface: the shared change request view, with `?file=` as the
// selected file because browse owns a route.
export default function MergeRequestDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scope = createBrowseScope()
  const number = () => params.number ?? ''
  const ready = () => scope.linked() && !!number()
  const model = createMemo(() => (ready() ? mrModel({ ...splitPath(scope.path()), number: number() }) : null))
  const changedFiles = useChangedFiles(() => model()?.files() ?? [])
  // Keyed, because the diff reads its route once: a new merge request gets a new diff.
  const route = createMemo<MergeRequestRoute | null>(
    () => (ready() ? { path: scope.path(), number: number(), key: `${scope.path()}!${number()}` } : null),
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
      const [detail, diff] = await forceRefresh(at.path, at.number)
      queryClient.setQueryData(mergeRequestKey(at.path, at.number), detail)
      queryClient.setQueryData(diffKey(at.path, at.number), diff)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mergeRequestsPrefixKey(at.path) }),
        queryClient.invalidateQueries({ queryKey: ['plugin-ref-resolutions'] }),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Show when={number()} fallback={<EmptyState title="Choose a merge request" />}>
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
              id="gitlab.merge-request"
              model={loaded()}
              currentFile={changedFiles.currentFile}
              onOpenFile={select}
              onLinkClick={onLinkClick}
              diffActions={() => (
                <IconButton
                  icon="refresh-cw"
                  tip="Refresh merge request"
                  label="Refresh merge request"
                  busy={refreshing()}
                  onPress={() => void refresh()}
                />
              )}
              diff={() => (
                <Show when={route()} keyed>
                  {(at) => <DiffForMergeRequest route={at} router />}
                </Show>
              )}
              checkPanel={(check, close) => <GitlabChecksPanel path={scope.path()} check={check} onClose={close} />}
            />
          </Show>
        )}
      </Show>
    </Show>
  )
}
