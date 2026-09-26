import { createMemo, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { openPane } from '@acorn/plugin-api/client'
import { filesKey, filePatchKey, pullKey, type PullFile, type PullFilesResponse } from '../shared/api'
import { fetchFilePatches, fileBlobOptions, fileSummariesOptions, filesOptions, mentionsOptions, pullDetailOptions } from './queries'
import { addReviewComment, replyReview, resolveThread } from './mutations'
import { Alert, DiffPane } from '@acorn/plugin-api/ui'
import type { DiffSource } from '@acorn/plugin-api/ui/diff'
import { DIFF_LINE_POINT } from './extensionPoints'
import { incompleteFilesMessage } from './completeness'

// Right (Diff) pane: the shared diff shell (client-core's DiffPane, docs/diff-rendering.md) filled in
// from a pull request. Everything here answers one of the shell's questions and nothing more: which
// files, where their patch bodies come from, which threads to interleave, and what a comment does.
//
// Browse requests full files. A task opened from the PR list already has file summaries in cache, so
// its diff can draw file rows immediately and fetch patch bodies through the hydrator in small batches.
// Binary and too-large files have no patch; the shell renders a "No diff" row for them.
//
// Until the shared source port carries completeness (phase 2 of docs/future/git-inspired/), this
// component owns the warning that GitHub's 3,000-file API limit cut the list short.
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
  const taskId = props.taskId

  const files = createQuery<PullFilesResponse>(() => props.router
    ? filesOptions(owner, repo, number, true)
    : fileSummariesOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, true))

  const fileList = () => files.data?.files
  const byPath = createMemo(() => new Map((fileList() ?? []).map((file) => [file.path, file])))
  // A force-push, a new commit, or a new base changes this, which is the shell's signal to drop parse
  // state, the remembered scroll offset, and any collapsed files. patchKey is the patch's own digest,
  // so a base change that leaves the head blob alone still moves it.
  const signature = createMemo(() => (fileList() ?? []).map((file) => `${file.path}:${file.sha}:${file.patchKey}`).join('\0'))

  const source: DiffSource = {
    scope: { taskId: props.taskId, routeKey: props.route.key },
    files: fileList,
    loading: () => files.isLoading,
    signature,
    selectedPath: () => typeof searchParams.file === 'string' ? searchParams.file : '',
    threads: () => detail.data?.threads,
    mentions: () => mentionsQuery.data ?? [],
    // Patch-body source. A file GitHub sent no patch for is resolved as it stands: the viewer draws
    // its no-diff row. An available patch counts only with its body in hand and the same patchKey,
    // checked in order: the per-path patch cache entry, then the warmed full files query. A summary
    // with no body is content still to fetch, never a file without a diff.
    cachedFile: (path) => {
      const current = byPath().get(path)
      if (!current) return null
      if (current.patchState === 'unavailable' || current.patch != null) return current
      const matches = (file: PullFile | undefined) => file?.patchKey === current.patchKey && file.patch != null ? file : null
      return matches(queryClient.getQueryData<PullFile>(filePatchKey(owner, repo, number, path)))
        ?? matches(queryClient.getQueryData<PullFilesResponse>(filesKey(owner, repo, number))?.files.find((entry) => entry.path === path))
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
    ...(taskId ? {
      openLine: (row: Parameters<NonNullable<DiffSource['openLine']>>[0]) => {
        if (row.newNo == null) return
        openPane(taskId, 'editor', { kind: 'editor:reveal', path: row.path, line: row.newNo }, 'add')
      },
    } : {}),
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
  // A sibling of the pane rather than a wrapper: DiffPane is a fragment that fills its container, and
  // the warning stays above it whichever file is on screen.
  return (
    <>
      <Show when={incompleteFilesMessage(files.data?.completeness)}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <DiffPane source={source} annotations={DIFF_LINE_POINT} />
    </>
  )
}
