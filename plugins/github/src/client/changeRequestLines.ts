import { createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { clientCapability, taskById } from '@acorn/plugin-api/client'
import { changeRequestLines } from '@acorn/change-request-ui/lines'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import { fetchDiffSegments, pullDiffOptions } from './queries'

/** The agent card on lines of a task's pull request, for a tree that shows them, such as the review
 *  guide. Its own module, because the client entry provides it eagerly. */
export const githubChangeRequestLines = changeRequestLines({
  inline: () => clientCapability(AGENTS_INLINE_DIFF),
  useDiff: (taskId) => {
    const pull = createMemo(() => {
      const task = taskById(taskId)
      return task?.github && task.pullNumber != null
        ? { owner: task.github.owner, repo: task.github.name, number: String(task.pullNumber) }
        : null
    })
    const diff = createQuery(() =>
      pullDiffOptions(pull()?.owner ?? '', pull()?.repo ?? '', pull()?.number ?? '', !!pull()),
    )
    return {
      pull,
      topology: () => diff.data?.document,
      loadSegments: (requests, signal) => fetchDiffSegments(pull()!.owner, pull()!.repo, requests, signal),
    }
  },
})
