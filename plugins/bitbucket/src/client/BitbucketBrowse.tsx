// The Bitbucket browse surface behind the `bitbucket` rail source, as two regions: the pull request
// list, and the one that's open. A terminal draws them in two panels, so each checks the routed project.
import { createSignal, lazy, Show, Suspense, type JSX } from 'solid-js'
import { useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { readJson } from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import { Button, EmptyState, Icon, IconButton, SectionHeader } from '@acorn/plugin-api/ui'
import { pullRequestsKey, pullRequestsRoute, type PullRequestList as ListAnswer } from '../shared/api'
import { createBrowseScope } from './browseScope'
import { newPullRequestUrl } from './pushActions'
import PullRequestList from './PullRequestList'

const PullRequestDetail = lazy(() => import('./PullRequestDetail'))

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

/** The `list` region: the pull requests, with the actions that belong to the whole list. */
export function BitbucketBrowseList() {
  const scope = createBrowseScope()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = createSignal(false)
  async function refresh() {
    if (!scope.repository()) return
    setRefreshing(true)
    try {
      const list = await readJson<ListAnswer>(`${pullRequestsRoute(scope.repository(), 'open')}&force=true`)
      queryClient.setQueryData(pullRequestsKey(scope.repository(), 'open'), list)
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <WhenLinked scope={scope} quiet>
      <SectionHeader
        actions={
          <>
            {/* Bitbucket's own form, which compares the branches and picks the destination. */}
            <Button tip="New pull request on Bitbucket" href={newPullRequestUrl(scope.repository())}>
              <Icon name="plus" /> New
            </Button>
            <IconButton
              icon="refresh-cw"
              tip="Refresh pull requests"
              label="Refresh pull requests"
              busy={refreshing()}
              onPress={() => void refresh()}
            />
          </>
        }
      >
        Pull requests
      </SectionHeader>
      <PullRequestList repository={scope.repository()} />
    </WhenLinked>
  )
}

/** The `detail` region: the pull request that's open. */
export function BitbucketBrowseDetail() {
  const scope = createBrowseScope()
  const params = useParams()
  return (
    <WhenLinked scope={scope}>
      <Show when={params.number} fallback={<EmptyState title="Choose a pull request" />}>
        <Suspense fallback={null}>
          <PullRequestDetail />
        </Suspense>
      </Show>
    </WhenLinked>
  )
}
