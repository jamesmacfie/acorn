import { createMemo, createResource, createSignal, onCleanup, type Accessor } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { projectBranchesRoute, projectConfigRoute, projectWorktreeAvailabilityRoute, projectWorktreesRoute, type Project, type ProjectBranches, type ProjectConfigResponse, type ProjectWorktree, type Task, type WorktreeAvailability } from '@acorn/protocol/api.ts'
import { slugifyBranch, withBranchPrefix } from '@acorn/protocol/branch.ts'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import { tasksKey } from '../../infra/queries'
import { createTask, patchTask } from '../tasks/taskMutations'
import { randomIconName } from '../../kit/components/inputs/IconPicker'
import { activateTaskSignals, pathForTask } from '../tasks/activate'

export type TaskDraft =
  | { mode: 'new'; nodeId: string | null; projects: Project[]; projectId: string }
  | { mode: 'rename'; nodeId: string | null; task: Task }

type TaskSource = 'new' | 'folder' | 'worktree'

// One owner for the dialog's edits and requests. The rail supplies a project snapshot and a live
// task revision; changing workspace cannot silently replace the project's choices in an open form.
export function createTaskDraftStore(draft: TaskDraft, tasks: Accessor<Task[] | undefined>, close: () => void, navigate: (path: string) => void) {
  const queryClient = useQueryClient()
  const [text, setText] = createSignal(draft.mode === 'rename' ? draft.task.title : '')
  const [icon, setIcon] = createSignal<string | null>(draft.mode === 'rename' ? draft.task.icon : randomIconName())
  const [projectId, setProjectId] = createSignal(draft.mode === 'new' ? draft.projectId : '')
  const [branchText, setBranchText] = createSignal('')
  const [branchTouched, setBranchTouched] = createSignal(false)
  const [baseChoice, setBaseChoice] = createSignal<{ projectId: string; branch: string } | null>(null)
  const [source, setSource] = createSignal<TaskSource>('new')
  const [pickedWorktree, setPickedWorktree] = createSignal('')
  const [skipSetup, setSkipSetup] = createSignal(false)
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  let alive = true
  onCleanup(() => { alive = false })

  const selectedProject = createMemo(() => draft.mode === 'new' ? draft.projects.find((project) => project.id === projectId()) : undefined)
  const gitProject = () => draft.mode === 'new' && selectedProject()?.vcs === 'git'
  const [config] = createResource(() => gitProject() ? projectId() : undefined,
    (id) => readJson<ProjectConfigResponse | null>(projectConfigRoute(id), { nodeId: draft.nodeId }))
  const [worktrees] = createResource(() => gitProject() ? projectId() : undefined,
    (id) => readJson<ProjectWorktree[]>(projectWorktreesRoute(id), { nodeId: draft.nodeId }).catch(() => null))
  const [branches] = createResource(() => gitProject() ? projectId() : undefined,
    (id) => readJson<ProjectBranches>(projectBranchesRoute(id), { nodeId: draft.nodeId }).catch(() => null))
  const baseBranch = () => baseChoice()?.projectId === projectId() ? baseChoice()?.branch : branches()?.current ?? undefined
  const chosenWorktree = () => {
    const list = worktrees() ?? []
    return list.find((worktree) => worktree.path === pickedWorktree()) ?? list[0]
  }
  const effectiveBranch = () => branchTouched() ? branchText() : withBranchPrefix(config()?.config.branchPrefix ?? null, slugifyBranch(text()))
  const request = createMemo(() => {
    if (!gitProject() || source() !== 'new' || !effectiveBranch()) return undefined
    tasks() // A task added or archived elsewhere requires a fresh availability answer.
    return { nodeId: draft.nodeId, projectId: projectId(), branch: effectiveBranch(), baseBranch: baseBranch(), branchSource: branchTouched() ? 'exact' as const : 'derived' as const }
  })
  const [availability] = createResource(request, async (identity) => ({
    identity,
    result: await readJson<WorktreeAvailability>(projectWorktreeAvailabilityRoute(identity.projectId, identity.branch, identity), { nodeId: identity.nodeId })
      .catch((): WorktreeAvailability => ({ available: true })),
  }))
  const checkedAvailability = () => {
    const checked = availability()
    const current = request()
    return checked && current && checked.identity.nodeId === current.nodeId && checked.identity.projectId === current.projectId && checked.identity.branch === current.branch && checked.identity.baseBranch === current.baseBranch && checked.identity.branchSource === current.branchSource
      ? checked.result : undefined
  }
  const branchError = () => {
    const result = checkedAvailability()
    return !availability.loading && result && !result.available ? result.reason : ''
  }
  const canSubmit = () => {
    if (saving() || activeNodeId() !== draft.nodeId || !text().trim()) return false
    if (!gitProject()) return true
    if (source() === 'folder') return true
    if (source() === 'worktree') return !!chosenWorktree()
    return !!effectiveBranch() && !config.loading && !branches.loading && !availability.loading && checkedAvailability()?.available === true
  }
  const submit = async () => {
    if (!canSubmit()) return
    setError('')
    const value = text().trim()
    setSaving(true)
    try {
      if (draft.mode === 'new') {
        const project = selectedProject()
        if (!project) return
        const git = project.vcs === 'git'
        const branch = git && source() === 'new' ? effectiveBranch() : undefined
        const worktreePath = git && source() === 'worktree' ? chosenWorktree()?.path : undefined
        const task = await createTask({
          ...(branch ? { baseBranch: baseBranch(), branchSource: branchTouched() ? 'exact' as const : 'derived' as const } : {}),
          origin: 'local', projectId: project.id, branch, worktreePath, title: value, icon: icon() ?? undefined,
          skipSetup: !!branch && skipSetup(),
        }, draft.nodeId)
        if (!alive || activeNodeId() !== draft.nodeId) return
        await queryClient.invalidateQueries({ queryKey: tasksKey })
        if (!alive || activeNodeId() !== draft.nodeId) return
        activateTaskSignals(task, { pane: 'pr' })
        navigate(pathForTask(task))
      } else {
        const body: { title?: string; icon?: string | null } = {}
        if (value !== draft.task.title) body.title = value
        if (icon() !== draft.task.icon) body.icon = icon()
        if (Object.keys(body).length) {
          await patchTask(draft.task.id, body, draft.nodeId)
          if (!alive || activeNodeId() !== draft.nodeId) return
          await queryClient.invalidateQueries({ queryKey: tasksKey })
        }
      }
      if (alive) close()
    } catch (cause) {
      if (alive) setError(cause instanceof Error ? cause.message : 'Could not save the task.')
    } finally {
      if (alive) setSaving(false)
    }
  }
  return {
    text, setText, icon, setIcon, projectId, setProjectId, branchText, setBranchText, branchTouched,
    setBranch: (value: string) => { setBranchTouched(true); setBranchText(value) },
    baseBranch, setBaseBranch: (branch: string) => setBaseChoice({ projectId: projectId(), branch }),
    source, setSource, pickedWorktree, setPickedWorktree, skipSetup, setSkipSetup, error, canSubmit, submit,
    selectedProject, worktrees, branches, chosenWorktree, effectiveBranch, checkedAvailability, branchError, availability,
  }
}
