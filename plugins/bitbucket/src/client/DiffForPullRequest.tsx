import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { clientCapability } from '@acorn/plugin-api/client'
import { changeRequestPointIds, inlineReviewThreads } from '@acorn/change-request-ui/model'
import { ChangeRequestDiff } from '@acorn/change-request-ui/views'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import { pullRequestKey } from '../shared/api'
import {
  diffOptions,
  fetchDiffSegments,
  fileTextOptions,
  membersOptions,
  pullRequestOptions,
  searchDiff,
} from './queries'
import { pullRequestWrites } from './mutations'
import { bitbucketHost } from './changeRequest'
import { splitRepository } from './clientRoutes'

// The pull request's diff: the shared change request diff, filled from Bitbucket's mirror. The document
// is the Node's, cut into segments, with no patch text in it.
export type PullRequestRoute = { repository: string; number: string; key: string }

export function DiffForPullRequest(props: {
  route: PullRequestRoute
  router: boolean
  taskId?: string
  readOnly?: boolean
}) {
  const searchParams = props.router ? useSearchParams()[0] : {}
  const queryClient = useQueryClient()
  const { repository, number } = props.route
  const diff = createQuery(() => diffOptions(repository, number, true))
  const detail = createQuery(() => pullRequestOptions(repository, number, true))
  const members = createQuery(() => membersOptions(repository, true))
  const topology = () => diff.data?.document
  const writes = pullRequestWrites(repository, number)

  return (
    <ChangeRequestDiff
      taskId={props.taskId}
      pull={{ ...splitRepository(repository), number }}
      inline={() => clientCapability(AGENTS_INLINE_DIFF)}
      warning={() => diff.data?.warning ?? null}
      annotations={changeRequestPointIds('bitbucket').diffLine}
      source={{
        scope: { taskId: props.taskId, routeKey: props.route.key },
        topology,
        loading: () => diff.isLoading || detail.isLoading,
        signature: () => topology()?.revision ?? '',
        selectedPath: () => (typeof searchParams.file === 'string' ? searchParams.file : ''),
        threads: () => inlineReviewThreads(detail.data, diff.data, bitbucketHost.avatar),
        mentions: () => (members.data ?? []).map((member) => member.login),
        loadSegments: (requests, signal) => fetchDiffSegments(repository, requests, signal),
        search: async (request, signal) => {
          const document = topology()
          return document ? searchDiff(repository, document, request, signal) : { matches: [], nextCursor: null }
        },
        // `sha` is the head commit, which the file is read at by its path.
        fileText: async (file) => (await queryClient.fetchQuery(fileTextOptions(repository, file.sha, file.path))).text,
        canComment: () => !props.readOnly && detail.data?.request?.headSha != null,
        ...(!props.readOnly
          ? {
              // Bitbucket places a comment by its line in the new file, or a deleted line's in the old.
              addComment: (body, { row }) =>
                writes.addLineComment(
                  body,
                  row.path,
                  row.kind === 'insert' ? null : row.oldNo,
                  row.kind === 'delete' ? null : row.newNo,
                ),
              reply: (commentId, body) => writes.reply(commentId, body),
              resolveThread: (threadId, resolved) => writes.resolve(threadId, resolved),
            }
          : {}),
        invalidate: () => void queryClient.invalidateQueries({ queryKey: pullRequestKey(repository, number) }),
        draftPrefix: `bitbucket:${repository}/${number}`,
        find: {
          commandId: 'bitbucket.diff.find',
          description: 'Find in diff',
          category: 'Pull requests',
          ...(props.router ? {} : { pane: 'bitbucket-pr' }),
        },
      }}
    />
  )
}
