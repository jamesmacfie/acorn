import { createMemo, createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Task } from '../queries'
import { projectsOptions, tasksKey, tasksOptions } from '../queries'
import { taskTracksRef } from './sources'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { createTask } from '../tasks/mutations'
import { Button, Select, Toolbar } from '../ui/primitives'
import type { RefPanelTarget } from './refPanels'

// "Is there a task for this thing, and if not, start one" — for ANY provider's reference panel.
//
// THE HOST DRAWS IT, and that is the load-bearing decision rather than a placement preference. A panel is
// frequently a sandboxed third-party rectangle, and creating a task is a core write that makes a worktree
// on the owner's disk. A plugin drawing this button itself would have to hold `core.tasks:write`
// permanently — for everything it ever does, not just for this click — to earn one affordance. Here the
// plugin holds nothing and the host does the write.
//
// It is a component a panel RENDERS rather than chrome wrapped around every panel, because the two kinds
// of panel disagree about who owns the box: a frame panel is wrapped by the host (plugins/frames/
// PluginRefPanel.tsx), a first-party one draws its own. One component both can place keeps the logic in
// one place without the host having to win that argument.

export default function RefPanelTaskLink(props: { target: RefPanelTarget }) {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const [chosen, setChosen] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  // Narrowed to the workspace the reader is in WHEN there is one to read. A panel opened over a project
  // page has a routed project and therefore a workspace; one opened over a dashboard has neither, and the
  // honest answer there is every repo rather than a guessed subset.
  const choices = createMemo(() => {
    const all = (projects.data ?? []).filter((project) => !project.hidden && project.path)
    const workspace = all.find((project) => project.id === params.projectId)?.workspaceId
    return workspace ? all.filter((project) => project.workspaceId === workspace) : all
  })
  const projectId = (): string => chosen() || (choices().length === 1 ? choices()[0]!.id : '')

  // `taskTracksRef` and not a link check written here, which is what this first did and why it was wrong
  // for the provider it was written alongside. A github-pr task records its pull request as `pullNumber`
  // on the task row rather than as a link, so matching only `task.links` found nothing for a PR and
  // offered to create a task that already existed. The host asks links first and then every source
  // (registries/sources.ts § tracksRef).
  //
  // FIRST match, and the honest ceiling: one reference can accumulate several tasks over time and this
  // shows the oldest. A chooser is the upgrade, and it needs a design rather than a `find` → `filter`.
  const existing = createMemo(() => (tasks.data ?? []).find((task) => taskTracksRef(task, props.target)))

  const open = (task: Task): void => {
    activateTaskSignals(task)
    navigate(pathForTask(task))
  }

  const create = async (): Promise<void> => {
    const project = projectId()
    // A ticket names no repo, so SOMETHING has to answer that, and the honest answer is the owner. Which
    // is why this is a picker whenever the choice is real, and not a button that quietly picks for them.
    if (!project || busy()) return
    setBusy(true)
    try {
      const task = await createTask({
        origin: 'manual',
        projectId: project,
        title: props.target.displayId,
        // The link is the whole point: it is what makes the NEXT visit to this panel offer to open the
        // task rather than to make a second one. A target with no connection cannot seed one — the seed
        // requires it — so that case creates a plain task, and the link can be added from the task side.
        ...(props.target.connectionId
          ? { links: [{ connectionId: props.target.connectionId, identifier: props.target.displayId, providerId: props.target.providerId }] }
          : {}),
      })
      await queryClient.invalidateQueries({ queryKey: tasksKey })
      open(task)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Toolbar>
      <Show
        when={existing()}
        fallback={(
          <>
            {/* One repo needs no question asked; several do. Zero means there is nothing to create INTO,
                and offering a button that cannot work is worse than offering none. */}
            <Show when={choices().length > 1}>
              <Select value={projectId()} onChange={(event) => setChosen(event.currentTarget.value)} aria-label="Project for the new task">
                <option value="">Choose a project…</option>
                <For each={choices()}>{(project) => <option value={project.id}>{project.name}</option>}</For>
              </Select>
            </Show>
            <Show when={choices().length}>
              <Button disabled={!projectId() || busy()} onClick={() => void create()}>
                {busy() ? 'Creating…' : 'Create task'}
              </Button>
            </Show>
          </>
        )}
      >
        {(task) => <Button onClick={() => open(task())}>Open task</Button>}
      </Show>
    </Toolbar>
  )
}
