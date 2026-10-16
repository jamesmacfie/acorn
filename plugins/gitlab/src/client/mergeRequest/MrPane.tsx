import { createMemo, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { clientEvents, handlePluginContentLinkClick, type Task } from '@acorn/plugin-api/client'
import { EmptyState } from '@acorn/plugin-api/ui'
import { ChangeRequestView, useChangedFiles } from '@acorn/change-request-ui/views'
import { DiffForMergeRequest, type MergeRequestRoute } from '../DiffForMergeRequest'
import GitlabChecksPanel from '../GitlabChecksPanel'
import { splitPath, taskMergeRequest } from '../clientRoutes'
import { mrModel } from './mrModel'

// The `mr` pane: the task's merge request, drawn by the shared change request view, the navigator
// beside the diff. A pane has no router, so the selected file is held locally and the diff hears about
// it through the file-scroll event.
export function MrPane(props: { task: Task }) {
  const navigate = useNavigate()
  const target = () => taskMergeRequest(props.task)
  const model = createMemo(() => {
    const at = target()
    return at ? mrModel({ ...splitPath(at.path), number: String(at.number), taskId: props.task.id }) : null
  })
  const changedFiles = useChangedFiles(() => model()?.files() ?? [], { router: false })
  const route = createMemo<MergeRequestRoute | null>(
    () => {
      const at = target()
      return at ? { path: at.path, number: String(at.number), key: `${at.path}!${at.number}` } : null
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
          id="gitlab.merge-request"
          model={loaded()}
          currentFile={changedFiles.currentFile}
          onOpenFile={select}
          onLinkClick={onLinkClick}
          diff={() => (
            <Show when={route()} keyed>
              {(at) => <DiffForMergeRequest route={at} router={false} taskId={props.task.id} />}
            </Show>
          )}
          checkPanel={(check, close) => <GitlabChecksPanel path={target()!.path} check={check} onClose={close} />}
        />
      )}
    </Show>
  )
}
