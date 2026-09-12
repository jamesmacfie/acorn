import { createMemo } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { filesKey, filePatchKey, pullKey, type PullFile } from '../shared/api'
import { fetchFilePatches, fileBlobOptions, filesOptions, mentionsOptions, pullDetailOptions } from './queries'
import { addReviewComment, replyReview, resolveThread } from './mutations'
import { DiffPane } from '@acorn/plugin-api/ui'
import type { DiffSource } from '@acorn/plugin-api/ui/diff'
import { DIFF_LINE_POINT } from './extensionPoints'

// Right (Diff) pane: the shared diff shell (client-core's DiffPane, docs/diff-rendering.md) filled in
// from a pull request. Everything here answers one of the shell's questions and nothing more: which
// files, where their patch bodies come from, which threads to interleave, and what a comment does.
//
// The files query returns the full changed-file payload up front. `fetchPatches` below only covers a
// body still missing from a partial or restored cache; binary and too-large files have no patch and
// the shell renders a "No diff" row instead.
export type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}

export function DiffForPull(props: { route: PullRoute; router: boolean; taskId?: string; readOnly?: boolean }) {
  const searchParams = props.router ? useSearchParams()[0] : {}
  const queryClient = useQueryClient()
  const owner = props.route.owner
  const repo = props.route.repo
  const number = props.route.number

  const files = createQuery(() => filesOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, true))

  // A force-push or a new commit changes this, which is the shell's signal to drop parse state, the
  // remembered scroll offset, and any collapsed files.
  const signature = createMemo(() => (files.data ?? []).map((file) => `${file.path}:${file.sha}:${file.additions}:${file.deletions}`).join('\0'))

  const source: DiffSource = {
    scope: { taskId: props.taskId, routeKey: props.route.key },
    files: () => files.data,
    loading: () => files.isLoading,
    signature,
    selectedPath: () => typeof searchParams.file === 'string' ? searchParams.file : '',
    threads: () => detail.data?.threads,
    mentions: () => mentionsQuery.data ?? [],
    // Patch-body source, checked in order: the per-path patch cache entry, then the warmed files
    // query (which also resolves binary and too-large files to their legitimate null patch).
    cachedFile: (path) => {
      const direct = queryClient.getQueryData<PullFile>(filePatchKey(owner, repo, number, path))
      if (direct) return direct
      const warmed = queryClient.getQueryData<PullFile[]>(filesKey(owner, repo, number))
      return warmed?.find((file) => file.path === path) ?? null
    },
    // Anything still missing comes from the batch patch endpoint, seeding per-path cache entries.
    fetchPatches: async (paths, signal) => {
      const fetched = await fetchFilePatches(owner, repo, number, paths, signal)
      for (const file of fetched) {
        queryClient.setQueryData(filePatchKey(owner, repo, number, file.path), file)
      }
      return fetched
    },
    // Immutable by sha, so one fetch per blob serves every gap in that file.
    fileText: async ({ sha }) => (await queryClient.fetchQuery(fileBlobOptions(owner, repo, sha))).text,
    canComment: () => !props.readOnly && detail.data?.pull?.headSha != null,
    ...(!props.readOnly ? {
      addComment: (body: string, { row, side, lineNo }: Parameters<NonNullable<DiffSource['addComment']>>[1]) =>
        addReviewComment(owner, repo, number, body, row.path, lineNo, side),
      reply: (databaseId: number, body: string) => replyReview(owner, repo, number, databaseId, body),
      resolveThread: (threadId: string, resolved: boolean) => resolveThread(owner, repo, number, threadId, resolved),
    } : {}),
    invalidate: () => void queryClient.invalidateQueries({ queryKey: pullKey(owner, repo, number) }),
    draftPrefix: `${owner}/${repo}/${number}`,
    // In router mode this pane owns the route, so the chord is claimed globally; in a task it is one
    // pane among several and has to be scoped to win only when the reader is looking at it.
    find: {
      commandId: 'github.diff.find',
      description: 'Find in diff',
      category: 'Pull requests',
      ...(props.router ? {} : { pane: 'pr' }),
    },
  }

  // What another plugin knows about a line of this diff — coverage, a lint result — drawn under the
  // row it belongs to. The host fetches, batches and stamps; this only names the point
  // (docs/plugins.md § Cooperative extension points, the `annotation` kind).
  return <DiffPane source={source} annotations={DIFF_LINE_POINT} />
}
