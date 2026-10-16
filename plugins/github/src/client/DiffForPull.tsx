import { createMemo } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { clientCapability } from '@acorn/plugin-api/client'
import { changeRequestPointIds, inlineReviewThreads } from '@acorn/change-request-ui/model'
import { ChangeRequestDiff } from '@acorn/change-request-ui/views'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import { pullKey } from '../shared/api'
import {
  fetchDiffSegments,
  fileBlobOptions,
  mentionsOptions,
  pullDetailOptions,
  pullDiffOptions,
  searchDiff,
} from './queries'
import { addReviewComment, replyReview, resolveThread } from './mutations'
import { githubAvatarUrl } from './avatar'
import { toChangeRequestDetail } from './changeRequest'
import { incompleteFilesMessage } from './completeness'
import { sayOnFailure } from './actionErrors'

// Right (Diff) pane: the shared change request diff filled in from a pull request. Everything here
// answers one of the shell's questions and nothing more: which document, where its segments come
// from, which threads to place, and what a comment does.
//
// The document is the node's (docs/github-integration/mirror.md § Diff documents): every file with the
// segments its patch was cut into, and no patch text. The file list's warning is GitHub's 3,000-file
// API limit.
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

  const diff = createQuery(() => pullDiffOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, true))
  const neutral = createMemo(() => (detail.data ? toChangeRequestDetail(detail.data) : undefined))
  const topology = () => diff.data?.document

  return (
    <ChangeRequestDiff
      taskId={props.taskId}
      pull={{ owner, repo, number }}
      inline={() => clientCapability(AGENTS_INLINE_DIFF)}
      warning={() => incompleteFilesMessage(diff.data?.completeness)}
      annotations={changeRequestPointIds('github').diffLine}
      source={{
        scope: { taskId: props.taskId, routeKey: props.route.key },
        topology,
        // The threads come with the detail, so the document is not ready until both are in.
        loading: () => diff.isLoading || detail.isLoading,
        // A force-push, a new commit, or a new base moves the revision, which is the shell's signal to
        // drop expanded gaps, the remembered scroll offset, and any collapsed files. A patch's key is its
        // own digest, so a base change that leaves the head blob alone still moves it.
        signature: () => topology()?.revision ?? '',
        selectedPath: () => (typeof searchParams.file === 'string' ? searchParams.file : ''),
        threads: () => inlineReviewThreads(neutral(), diff.data, githubAvatarUrl),
        mentions: () => mentionsQuery.data ?? [],
        loadSegments: (requests, signal) => fetchDiffSegments(owner, repo, requests, signal),
        search: async (request, signal) => {
          const document = topology()
          return document ? searchDiff(owner, repo, document, request, signal) : { matches: [], nextCursor: null }
        },
        // Immutable by sha, so one fetch per blob serves every gap in that file.
        fileText: async ({ sha }) => (await queryClient.fetchQuery(fileBlobOptions(owner, repo, sha))).text,
        canComment: () => !props.readOnly && detail.data?.pull?.headSha != null,
        ...(!props.readOnly
          ? {
              addComment: (body, { row, side, lineNo }) =>
                addReviewComment(owner, repo, number, body, row.path, lineNo, side),
              reply: (databaseId, body) =>
                sayOnFailure(replyReview(owner, repo, number, databaseId, body), "Couldn't save your reply."),
              resolveThread: (threadId, resolved) =>
                sayOnFailure(
                  resolveThread(owner, repo, number, threadId, resolved),
                  resolved ? "Couldn't resolve the thread." : "Couldn't unresolve the thread.",
                ),
            }
          : {}),
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
      }}
    />
  )
}
