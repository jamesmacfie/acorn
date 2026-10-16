import { createMemo, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { clientEvents, handlePluginContentLinkClick, type Task } from '@acorn/plugin-api/client'
import { EmptyState } from '@acorn/plugin-api/ui'
import { ChangeRequestView, useChangedFiles } from '@acorn/change-request-ui/views'
import { DiffForPullRequest, type PullRequestRoute } from '../DiffForPullRequest'
import { splitRepository, taskPullRequest } from '../clientRoutes'
import { prModel } from './prModel'

// The `bitbucket-pr` pane: the task's pull request, drawn by the shared change request view, the
// navigator beside the diff. A pane has no router, so the selected file is held locally and the diff
// hears about it through the file-scroll event. A build status has no log, so there's no check panel.
export function PrPane(props: { task: Task }) {
  const navigate = useNavigate()
  const target = () => taskPullRequest(props.task)
  const model = createMemo(() => {
    const at = target()
    return at ? prModel({ ...splitRepository(at.repository), number: String(at.number), taskId: props.task.id }) : null
  })
  const changedFiles = useChangedFiles(() => model()?.files() ?? [], { router: false })
  const route = createMemo<PullRequestRoute | null>(
    () => {
      const at = target()
      return at ? { repository: at.repository, number: String(at.number), key: `${at.repository}#${at.number}` } : null
    },
    null,
    { equals: (a, b) => a?.key === b?.key },
  )
  const select = (path: string) => {
    changedFiles.selectFile(path)
    const key = route()?.key
    if (key) clientEvents.emit('presentation:file-scroll', { routeKey: key, path })
  }
  const onLinkClick = (event: MouseEvent) =>
    handlePluginContentLinkClick(event, { taskId: props.task.id, prefer: 'refPanel', navigate })

  return (
    <Show
      when={model()}
      fallback={
        <EmptyState align="start" busy>
          Loading…
        </EmptyState>
      }
    >
      {(loaded) => (
        <ChangeRequestView
          id="bitbucket.pull-request"
          model={loaded()}
          currentFile={changedFiles.currentFile}
          onOpenFile={select}
          onLinkClick={onLinkClick}
          diff={() => (
            <Show when={route()} keyed>
              {(at) => <DiffForPullRequest route={at} router={false} taskId={props.task.id} />}
            </Show>
          )}
        />
      )}
    </Show>
  )
}
