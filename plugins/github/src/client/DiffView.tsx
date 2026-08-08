import { createMemo, Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { projectsOptions, type Task } from '@acorn/client-core/queries.ts'
import { routeKey as makeRouteKey } from './fileNavigation'
import { DiffForPull, type PullRoute } from './DiffForPull'

export default function DiffView(props: { task?: Task } = {}) {
  const params = props.task ? null : useParams()
  const projects = createQuery(() => projectsOptions(true))
  const route = createMemo<PullRoute | null>(() => {
    const project = projects.data?.find((candidate) => candidate.id === params?.projectId)
    const owner = props.task?.github?.owner ?? project?.github?.owner
    const repo = props.task?.github?.name ?? project?.github?.name
    const number = props.task?.pullNumber != null ? String(props.task.pullNumber) : params?.number
    if (!owner || !repo || !number) return null
    return {
      owner,
      repo,
      number,
      key: makeRouteKey(owner, repo, number),
    }
  })

  return (
    <Show when={route()} keyed fallback={<p class="placeholder">Select a PR.</p>}>
      {(r) => <DiffForPull route={r} router={!props.task} taskId={props.task?.id} />}
    </Show>
  )
}
