// Archive-time container cleanup: contributes a `task:archive` concern with an "also stop its
// containers" checkbox when the task has linked running containers. Reads the polled summary store
// (collectConcerns has a 250ms budget — no fetch here); the teardown fires-and-forgets alongside
// the archive (compose down works by project name even after the worktree is removed).
import { registerWillHandler, type Concern } from '../../../core/client/registries/willPhase'
import { teardownTaskContainers } from './dockerClient'
import { dockerTaskSummary } from './dockerStore'

export function registerDockerArchiveConcern(): void {
  registerWillHandler('task:archive', 'docker', ({ taskId }): Concern | null => {
    const summary = dockerTaskSummary(taskId)
    if (!summary || summary.running === 0) return null
    return {
      id: 'docker-containers',
      feature: 'docker',
      severity: 'warn',
      message: `${summary.running} running container${summary.running === 1 ? ' is' : 's are'} linked to this task`,
      checkbox: { label: 'Also stop its containers', checked: true },
      onDecision: (confirmed, checked) => {
        if (confirmed && checked) void teardownTaskContainers(taskId).catch((e) => console.error('[docker] teardown failed:', e))
      },
    }
  })
}
