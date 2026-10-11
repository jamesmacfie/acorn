import { activeNodeId, clientCapability, requestTaskLaunch, toast } from '@acorn/plugin-api/client'
import { WORKFLOW_GIT_LAUNCH } from '@acorn/plugin-workflows/contract/gitLaunch.ts'
import type { OperationKind, Worktree } from '../shared/api'
import { operationChoices } from './operationClient'

export function sameGitActionScope(nodeId: string | null, projectId: string, currentProjectId: string): boolean {
  if (activeNodeId() === nodeId && projectId === currentProjectId) return true
  toast('The Node or project changed. Reopen Git actions before continuing.', { tone: 'danger' })
  return false
}

export function launchWorkflowAtCommit(nodeId: string | null, projectId: string, commitId: string, title: string): void {
  if (activeNodeId() !== nodeId) {
    toast('The Node changed. Reopen Git actions before launching.', { tone: 'danger' })
    return
  }
  const workflow = clientCapability(WORKFLOW_GIT_LAUNCH)
  if (!workflow) {
    toast('Workflows is unavailable on this Node.', { tone: 'danger' })
    return
  }
  workflow.open({ nodeId, projectId, commitId, title })
}

export function commitActionRequest(commit: { id: string; subject: string; refs: string[]; parents: string[] }, nodeId: string | null, projectId: string,
  currentProjectId: () => string, onSelect: (id: string) => void, operate: (operation: OperationKind) => void) {
  const valid = () => sameGitActionScope(nodeId, projectId, currentProjectId())
  const launchTask = () => { if (valid()) requestTaskLaunch({ nodeId, projectId, title: commit.subject, baseCommit: commit.id }) }
  const launchWorkflow = () => { if (valid()) launchWorkflowAtCommit(nodeId, projectId, commit.id, commit.subject) }
  return { title: 'Commit actions', detail: `${commit.subject} · ${commit.id.slice(0, 12)}`, actions: [
    { id: 'inspect', label: 'Inspect commit', run: () => { if (valid()) onSelect(commit.id) } },
    { id: 'task', label: 'Start task here', run: launchTask },
    { id: 'workflow', label: 'Start workflow here', run: launchWorkflow },
    ...commit.refs.filter((ref) => ref.startsWith('refs/heads/')).flatMap((ref) => [
      { id: `task:${ref}`, label: `Start task at ${ref.slice(11)} tip`, run: launchTask },
      { id: `workflow:${ref}`, label: `Start workflow at ${ref.slice(11)} tip`, run: launchWorkflow },
    ]),
    ...operationChoices(commit.parents.length).map((choice) => ({ id: choice.operation, label: choice.label, run: () => { if (valid()) operate(choice.operation) } })),
  ] }
}

export function worktreeActionRequest(row: Pick<Worktree, 'path' | 'branch' | 'owners' | 'main' | 'missing' | 'locked'>,
  nodeId: string | null, projectId: string,
  currentProjectId: () => string, openTask: (taskId: string) => void, view: () => void) {
  const valid = () => sameGitActionScope(nodeId, projectId, currentProjectId())
  return { title: 'Worktree actions', detail: `${row.branch ?? 'Detached HEAD'} · ${row.path}`, actions: [
    { id: 'view', label: 'View worktree', run: () => { if (valid()) view() } },
    ...(row.owners[0] ? [{ id: 'open', label: 'Open task', run: () => { if (valid()) openTask(row.owners[0]!.id) } }] : []),
    ...(!row.owners.length && !row.main && !row.missing && !row.locked && row.branch
      ? [{ id: 'attach', label: 'Attach to task', run: () => { if (valid()) requestTaskLaunch({ nodeId, projectId, title: row.branch!, worktreePath: row.path }) } }] : []),
  ] }
}
