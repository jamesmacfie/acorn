import { createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { clientCapability, taskById } from '@acorn/plugin-api/client'
import { changeRequestLines } from '@acorn/change-request-ui/lines'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import { splitRepository, taskPullRequest } from './clientRoutes'
import { diffOptions, fetchDiffSegments } from './queries'

/** The agent card on lines of a task's pull request, for a tree that shows them, such as the review
 *  guide. Its own module, because the client entry provides it eagerly. */
export const bitbucketChangeRequestLines = changeRequestLines({
  inline: () => clientCapability(AGENTS_INLINE_DIFF),
  useDiff: (taskId) => {
    const target = createMemo(() => {
      const task = taskById(taskId)
      return task ? taskPullRequest(task) : null
    })
    const diff = createQuery(() => diffOptions(target()?.repository ?? '', String(target()?.number ?? ''), !!target()))
    return {
      pull: () => {
        const at = target()
        return at ? { ...splitRepository(at.repository), number: String(at.number) } : null
      },
      topology: () => diff.data?.document,
      loadSegments: (requests, signal) => fetchDiffSegments(target()!.repository, requests, signal),
    }
  },
})
