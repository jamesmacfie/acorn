import { createMemo, Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { projectsOptions } from '@acorn/plugin-api/client'
import { routeKey as makeRouteKey } from './fileNavigation'
import { DiffForPull, type PullRoute } from './DiffForPull'
import { EmptyState } from '@acorn/plugin-api/ui'

// The diff column of the browse surface. The PR pane reaches `DiffForPull` directly from its Files
// tab, where the route comes from the selected pull rather than from the URL.
export default function DiffView() {
  const params = useParams()
  const projects = createQuery(() => projectsOptions(true))
  const route = createMemo<PullRoute | null>(() => {
    const project = projects.data?.find((candidate) => candidate.id === params.projectId)
    const owner = project?.github?.owner
    const repo = project?.github?.name
    const number = params.number
    if (!owner || !repo || !number) return null
    return { owner, repo, number, key: makeRouteKey(owner, repo, number) }
  })

  return (
    <Show when={route()} keyed fallback={<EmptyState align="start">Select a PR.</EmptyState>}>
      {(resolved) => <DiffForPull route={resolved} router />}
    </Show>
  )
}
