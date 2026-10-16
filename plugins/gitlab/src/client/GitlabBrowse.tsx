// The GitLab browse surface behind the `gitlab` rail source, as two regions: the merge request list,
// and the one that's open. A terminal draws them in two panels, so each checks the routed project.
import { createSignal, lazy, Show, Suspense, type JSX } from 'solid-js'
import { useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { readJson } from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import { Button, EmptyState, Icon, IconButton, SectionHeader } from '@acorn/plugin-api/ui'
import { mergeRequestsKey, mergeRequestsRoute, type MergeRequestRow } from '../shared/api'
import { createBrowseScope } from './browseScope'
import { newMergeRequestUrl } from './pushActions'
import MergeRequestList from './MergeRequestList'

const MergeRequestDetail = lazy(() => import('./MergeRequestDetail'))

function WhenLinked(props: { scope: ReturnType<typeof createBrowseScope>; quiet?: boolean; children: JSX.Element }) {
  return (
    <Show
      when={props.scope.linked()}
      fallback={
        <Show when={!props.quiet}>
          <Show when={props.scope.emptyMessage()} fallback={<Acorn />}>
            {(message) => <EmptyState title={message().title}>{message().body}</EmptyState>}
          </Show>
        </Show>
      }
    >
      {props.children}
    </Show>
  )
}

/** The `list` region: the merge requests, with the actions that belong to the whole list. */
export function GitlabBrowseList() {
  const scope = createBrowseScope()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = createSignal(false)
  async function refresh() {
    if (!scope.address()) return
    setRefreshing(true)
    try {
      const rows = await readJson<MergeRequestRow[]>(`${mergeRequestsRoute(scope.address(), 'open')}&force=true`)
      queryClient.setQueryData(mergeRequestsKey(scope.address(), 'open'), rows)
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <WhenLinked scope={scope} quiet>
      <SectionHeader
        actions={
          <>
            {/* GitLab's own form, which compares the branches and picks the target. */}
            <Button tip="New merge request on GitLab" href={newMergeRequestUrl(scope.address())}>
              <Icon name="plus" /> New
            </Button>
            <IconButton
              icon="refresh-cw"
              tip="Refresh merge requests"
              label="Refresh merge requests"
              busy={refreshing()}
              onPress={() => void refresh()}
            />
          </>
        }
      >
        Merge requests
      </SectionHeader>
      <MergeRequestList address={scope.address()} />
    </WhenLinked>
  )
}

/** The `detail` region: the merge request that's open. */
export function GitlabBrowseDetail() {
  const scope = createBrowseScope()
  const params = useParams()
  return (
    <WhenLinked scope={scope}>
      <Show when={params.number} fallback={<EmptyState title="Choose a merge request" />}>
        <Suspense fallback={null}>
          <MergeRequestDetail />
        </Suspense>
      </Show>
    </WhenLinked>
  )
}
