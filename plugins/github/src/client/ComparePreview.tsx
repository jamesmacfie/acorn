import { Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { compareOptions, fetchDiffSegments, searchDiff } from './queries'
import { projectsOptions } from '@acorn/plugin-api/client'
import { Alert, DiffPane, EmptyState } from '@acorn/plugin-api/ui'
import type { DiffSource } from '@acorn/plugin-api/ui/diff'
import { incompleteFilesMessage } from './completeness'

// The preview column in create mode: a read-only `base..head` diff.
//
// The same viewer the pull request itself gets, given a source with nothing to write to: no threads,
// no line composers, no gap expansion, none of which exist before the pull does. The compare route
// answers with a document, as a pull's diff route does, and the preview loads segments through the
// same repository routes; binary and too-large files have no patch and the viewer draws its "No diff"
// row. GitHub's compare lists at most 300 changed files, so a capped comparison says so above the diff.
export default function ComparePreview() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const github = () => project()?.github
  const owner = () => github()?.owner ?? ''
  const repo = () => github()?.name ?? ''
  const base = () => (typeof searchParams.base === 'string' && searchParams.base) || project()?.defaultBranch || ''
  const head = () => (typeof searchParams.head === 'string' ? searchParams.head : '')
  const comparable = () => !!head() && head() !== base()
  const compare = createQuery(() => compareOptions(owner(), repo(), base(), head(), !!github() && comparable()))
  const topology = () => compare.data?.document

  const source: DiffSource = {
    scope: { routeKey: `compare:${params.projectId ?? ''}` },
    topology,
    loading: () => compare.isLoading,
    // A different branch pair is a different diff, so the viewer drops its collapsed files and its
    // remembered offset when this moves.
    signature: () => `${base()}...${head()}^@${topology()?.revision ?? ''}`,
    selectedPath: () => '',
    loadSegments: (requests, signal) => fetchDiffSegments(owner(), repo(), requests, signal),
    search: async (request, signal) => {
      const document = topology()
      return document ? searchDiff(owner(), repo(), document, request, signal) : { matches: [], nextCursor: null }
    },
    canComment: () => false,
    invalidate: () => {},
    draftPrefix: `compare:${params.projectId ?? ''}`,
    find: { commandId: 'github.compare.find', description: 'Find in compare', category: 'Pull requests' },
  }

  return (
    <Show
      when={comparable()}
      fallback={<EmptyState title="Choose a branch">The changes it would merge show here.</EmptyState>}
    >
      <Show when={!compare.isLoading} fallback={<EmptyState align="start" size="sm" busy>Loading…</EmptyState>}>
        <Show
          when={(compare.data?.aheadBy ?? 0) > 0}
          fallback={<EmptyState title="Nothing to merge">These branches are the same, so there's nothing to merge.</EmptyState>}
        >
          <Show when={incompleteFilesMessage(compare.data?.completeness)}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
          <DiffPane source={source} />
        </Show>
      </Show>
    </Show>
  )
}
