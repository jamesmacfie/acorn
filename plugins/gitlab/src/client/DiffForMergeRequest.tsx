import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { clientCapability } from '@acorn/plugin-api/client'
import { changeRequestPointIds, inlineReviewThreads } from '@acorn/change-request-ui/model'
import { ChangeRequestDiff } from '@acorn/change-request-ui/views'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import { mergeRequestKey } from '../shared/api'
import {
  diffOptions,
  fetchDiffSegments,
  fileTextOptions,
  membersOptions,
  mergeRequestOptions,
  searchDiff,
} from './queries'
import { mergeRequestWrites } from './mutations'
import { gitlabHost } from './changeRequest'
import { splitPath } from './clientRoutes'

// The merge request's diff: the shared change request diff, filled from GitLab's mirror. The document
// is the Node's, cut into segments, with no patch text in it.
export type MergeRequestRoute = { address: string; number: string; key: string }

export function DiffForMergeRequest(props: {
  route: MergeRequestRoute
  router: boolean
  taskId?: string
  readOnly?: boolean
}) {
  const searchParams = props.router ? useSearchParams()[0] : {}
  const queryClient = useQueryClient()
  const { address, number } = props.route
  const diff = createQuery(() => diffOptions(address, number, true))
  const detail = createQuery(() => mergeRequestOptions(address, number, true))
  const members = createQuery(() => membersOptions(address, true))
  const topology = () => diff.data?.document
  const writes = mergeRequestWrites(address, number)

  return (
    <ChangeRequestDiff
      taskId={props.taskId}
      pull={{ ...splitPath(address), number }}
      inline={() => clientCapability(AGENTS_INLINE_DIFF)}
      warning={() => diff.data?.warning ?? null}
      annotations={changeRequestPointIds('gitlab').diffLine}
      source={{
        scope: { taskId: props.taskId, routeKey: props.route.key },
        topology,
        loading: () => diff.isLoading || detail.isLoading,
        signature: () => topology()?.revision ?? '',
        selectedPath: () => (typeof searchParams.file === 'string' ? searchParams.file : ''),
        threads: () => inlineReviewThreads(detail.data, diff.data, gitlabHost.avatar),
        mentions: () => (members.data ?? []).map((member) => member.login),
        loadSegments: (requests, signal) => fetchDiffSegments(address, requests, signal),
        search: async (request, signal) => {
          const document = topology()
          return document ? searchDiff(address, document, request, signal) : { matches: [], nextCursor: null }
        },
        // `sha` is the head commit, which the file is read at by its path.
        fileText: async (file) => (await queryClient.fetchQuery(fileTextOptions(address, file.sha, file.path))).text,
        canComment: () => !props.readOnly && detail.data?.request?.headSha != null,
        ...(!props.readOnly
          ? {
              // GitLab places a note by the line on each side: both for an unchanged line.
              addComment: (body, { row }) =>
                writes.addNote(
                  body,
                  row.path,
                  row.kind === 'insert' ? null : row.oldNo,
                  row.kind === 'delete' ? null : row.newNo,
                ),
              reply: (noteId, body) => writes.reply(noteId, body),
              resolveThread: (discussionId, resolved) => writes.resolve(discussionId, resolved),
            }
          : {}),
        invalidate: () => void queryClient.invalidateQueries({ queryKey: mergeRequestKey(address, number) }),
        draftPrefix: `gitlab:${address}/${number}`,
        find: {
          commandId: 'gitlab.diff.find',
          description: 'Find in diff',
          category: 'Merge requests',
          ...(props.router ? {} : { pane: 'mr' }),
        },
      }}
    />
  )
}
