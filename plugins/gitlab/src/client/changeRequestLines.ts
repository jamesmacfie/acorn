import { createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { clientCapability, taskById } from '@acorn/plugin-api/client'
import { changeRequestLines } from '@acorn/change-request-ui/lines'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import { splitPath, taskMergeRequest } from './clientRoutes'
import { diffOptions, fetchDiffSegments } from './queries'

/** The agent card on lines of a task's merge request, for a tree that shows them, such as the review
 *  guide. Its own module, because the client entry provides it eagerly. */
export const gitlabChangeRequestLines = changeRequestLines({
  inline: () => clientCapability(AGENTS_INLINE_DIFF),
  useDiff: (taskId) => {
    const target = createMemo(() => {
      const task = taskById(taskId)
      return task ? taskMergeRequest(task) : null
    })
    const diff = createQuery(() => diffOptions(target()?.address ?? '', String(target()?.number ?? ''), !!target()))
    return {
      pull: () => {
        const at = target()
        return at ? { ...splitPath(at.address), number: String(at.number) } : null
      },
      topology: () => diff.data?.document,
      loadSegments: (requests, signal) => fetchDiffSegments(target()!.address, requests, signal),
    }
  },
})
