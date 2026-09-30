import { createEffect, createMemo, createSignal, Index, Show } from 'solid-js'
import type { Project, Workspace } from '@acorn/protocol/api.ts'
import { resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { canPickFolder } from '../../infra/platform'
import { createWorkspace, patchProject } from './workspaceMutations'
import { PROJECT_COLOR_OPTIONS } from './ProjectColorInput'
import Icon from '../../kit/components/content/Icon'
import { Text } from '../../kit/components/content/Text'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Badge, Button, Checkbox, Input, Select, Table, TableCell, TableHead, TableRow } from '../../kit/components/primitives'
import { Toolbar } from '../../kit/components/layout/Toolbar'
import './onboarding.css'

// Projects as a table, grouped under their workspace, with row selection and a bar for the changes
// people make to several projects at once: move, hide, and colour (docs/workspaces-and-tasks.md).
// Overview draws every workspace's group; a workspace's own page draws its one group without a head.
//
// A row opens its project's page rather than carrying the controls itself, so renaming, the folder and
// deleting live there. The bar loops the one-project route rather than asking the node for a bulk
// one: a move or a hide is a single column on each row, a handful of rows is a handful of writes, and
// a failure is reported per project instead of failing the lot.

/** Sentinel option value: "move to a workspace that does not exist yet". */
const NEW_WORKSPACE = '__new__'

export type ProjectGroup = { id: string; label: string; workspaceId?: string; projects: Project[] }

export function ProjectTable(props: {
  groups: readonly ProjectGroup[]
  workspaces: readonly Workspace[]
  taskCount: (projectId: string) => number
  /** Draw each group's head row. Off on a workspace's own page, which is the group. */
  groupHeads: boolean
  openProject: (projectId: string) => void
  openWorkspace?: (workspaceId: string) => void
  /** Give a path-less project a folder from its row. Without it the row only says it has none. */
  mapFolder?: (projectId: string) => void
  /** Refetch the lists the table was drawn from, once the writes land. */
  refresh: () => Promise<unknown>
}) {
  const all = createMemo(() => props.groups.flatMap((group) => group.projects))
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [result, setResult] = createSignal<BulkResult>()
  // A project deleted or moved off this table drops out of the selection with it.
  createEffect(() => {
    const present = new Set(all().map((project) => project.id))
    setSelected((current) => ([...current].every((id) => present.has(id)) ? current : new Set([...current].filter((id) => present.has(id)))))
  })
  const isSelected = (id: string) => selected().has(id)
  const toggle = (ids: readonly string[], on: boolean) => setSelected((current) => {
    const next = new Set(current)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    return next
  })
  const chosen = () => all().filter((project) => isSelected(project.id))

  return (
    <>
      <Table size="sm">
        <TableRow head>
          <TableHead>
            <Checkbox
              ariaLabel="Select every project"
              checked={all().length > 0 && chosen().length === all().length}
              indeterminate={chosen().length > 0 && chosen().length < all().length}
              disabled={!all().length}
              onChange={(on) => toggle(all().map((project) => project.id), on)}
            />
          </TableHead>
          <TableHead>Project</TableHead>
          <TableHead priority="low">Folder</TableHead>
          <TableHead priority="low">Detected</TableHead>
          <TableHead align="end">Tasks</TableHead>
          <TableHead><span class="sr-only">Open</span></TableHead>
        </TableRow>
        <Index each={props.groups}>
          {(group) => (
            <>
              <Show when={props.groupHeads}>
                <TableRow>
                  <TableCell>
                    <Show when={group().projects.length}>
                      <Checkbox
                        ariaLabel={`Select every project in ${group().label}`}
                        checked={group().projects.every((project) => isSelected(project.id))}
                        indeterminate={group().projects.some((project) => isSelected(project.id)) && !group().projects.every((project) => isSelected(project.id))}
                        onChange={(on) => toggle(group().projects.map((project) => project.id), on)}
                      />
                    </Show>
                  </TableCell>
                  <TableCell header>
                    <Show when={group().workspaceId && props.openWorkspace} fallback={<Text emphasis="strong">{group().label}</Text>}>
                      <Button variant="bare" size="sm" title={`Open ${group().label}`} onPress={() => props.openWorkspace?.(group().workspaceId!)}>
                        <Text emphasis="strong">{group().label}</Text>
                      </Button>
                    </Show>
                  </TableCell>
                  <TableCell>
                    <Text emphasis="muted">{group().projects.length || 'no'} project{group().projects.length === 1 ? '' : 's'}</Text>
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                </TableRow>
              </Show>
              {/* Index, not For: a refetch after every write hands back new objects, and For would
                  rebuild the rows under the pointer and drop the focus on the row's checkbox. */}
              <Index each={group().projects}>
                {(project) => (
                  <TableRow>
                    <TableCell>
                      <Checkbox ariaLabel={`Select ${project().name}`} checked={isSelected(project().id)} onChange={(on) => toggle([project().id], on)} />
                    </TableCell>
                    <TableCell header>
                      <span class="ws-project-name">
                        <span class="ws-project-dot" style={{ background: resolveProjectColor(project().color) ?? 'transparent' }} data-empty={project().color ? undefined : ''} aria-hidden="true" />
                        <Button variant="bare" size="sm" onPress={() => props.openProject(project().id)}>{project().name}</Button>
                        <Show when={project().hidden}><Badge>hidden</Badge></Show>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Show
                        when={project().path}
                        fallback={
                          <span class="ws-row-nopath">
                            No folder on disk
                            <Show when={props.mapFolder && canPickFolder()}>
                              {' '}<Button variant="bare" size="sm" onPress={() => props.mapFolder?.(project().id)}>Add folder</Button>
                            </Show>
                          </span>
                        }
                      >
                        {/* data-tip: the only way to read a path the column had to ellipsise. */}
                        <span class="ws-row-path" data-tip={project().path ?? undefined}>{project().path}</span>
                      </Show>
                    </TableCell>
                    <TableCell>
                      {/* Marks, not words, each with a title so the meaning survives for a tooltip or a
                          screen reader. */}
                      <span class="ws-row-facets">
                        <Show when={project().path && project().vcs !== 'git'}><Icon name="folder" title="Plain folder" /></Show>
                        <Show when={project().vcs === 'git'}><Icon name="git-commit-horizontal" title="Git repository" /></Show>
                        <Show when={project().github}><Icon name="brand:github" title="GitHub repository" /></Show>
                      </span>
                    </TableCell>
                    <TableCell align="end">{props.taskCount(project().id)}</TableCell>
                    <TableCell align="end">
                      <IconButton icon="chevron-right" label={`Open ${project().name}`} onPress={() => props.openProject(project().id)} />
                    </TableCell>
                  </TableRow>
                )}
              </Index>
            </>
          )}
        </Index>
      </Table>

      <Show when={chosen().length}>
        <BulkBar
          projects={chosen()}
          workspaces={props.workspaces}
          refresh={props.refresh}
          report={setResult}
          onClear={() => { setSelected(new Set<string>()); setResult(undefined) }}
        />
      </Show>
      {/* Outside the bar, which goes when its projects leave the selection: a move off a workspace's page
          takes every moved row with it, and the result still has to be read. */}
      <Show when={result()}>{(done) => <Text tone={done().tone} wrap>{done().text}</Text>}</Show>
    </>
  )
}

type BulkResult = { tone: 'ok' | 'danger'; text: string }

// The bar under a table with rows selected. Each action writes every selected project and then says
// what happened, naming the ones that failed.
function BulkBar(props: {
  projects: readonly Project[]
  workspaces: readonly Workspace[]
  refresh: () => Promise<unknown>
  report: (result: BulkResult | undefined) => void
  onClear: () => void
}) {
  const [busy, setBusy] = createSignal(false)
  const setResult = props.report
  const [naming, setNaming] = createSignal<string | null>(null)
  const count = () => props.projects.length
  const noun = (n: number) => `${n} project${n === 1 ? '' : 's'}`
  const allHidden = () => props.projects.every((project) => project.hidden)

  // `done` words what happened to a count of projects: `(what) => \`Moved ${what} to Runn\``.
  const each = async (done: (what: string) => string, write: (project: Project) => Promise<unknown>) => {
    setBusy(true)
    setResult(undefined)
    const targets = [...props.projects]
    const failures: string[] = []
    for (const project of targets) {
      try {
        await write(project)
      } catch (cause) {
        failures.push(`${project.name}: ${cause instanceof Error ? cause.message : 'could not save'}`)
      }
    }
    await props.refresh().catch(() => undefined)
    setBusy(false)
    const saved = targets.length - failures.length
    setResult(failures.length
      ? { tone: 'danger', text: `${done(`${saved} of ${noun(targets.length)}`)}. ${failures.join('. ')}.` }
      : { tone: 'ok', text: `${done(noun(saved))}.` })
  }

  const moveTo = (workspaceId: string) => {
    if (workspaceId === NEW_WORKSPACE) {
      setNaming('')
      return
    }
    const name = props.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? 'that workspace'
    void each((what) => `Moved ${what} to ${name}`, (project) => patchProject(project.id, { workspaceId }))
  }
  const moveToNew = async (event: Event) => {
    event.preventDefault()
    const name = naming()?.trim()
    if (!name) return
    setBusy(true)
    try {
      const workspace = await createWorkspace(name)
      setNaming(null)
      await each((what) => `Moved ${what} to ${name}`, (project) => patchProject(project.id, { workspaceId: workspace.id }))
    } catch (cause) {
      setBusy(false)
      setResult({ tone: 'danger', text: cause instanceof Error ? cause.message : 'Could not create that workspace.' })
    }
  }

  return (
    <div class="ws-bulk" role="region" aria-label="Selected projects">
      <Toolbar variant="bar" ariaLabel="Change the selected projects">
        <Text emphasis="strong">{count()} selected</Text>
        <Show
          when={naming() === null}
          fallback={
            <form class="ws-add-form" onSubmit={(event) => void moveToNew(event)}>
              <Input
                label="New workspace name"
                placeholder="Workspace name (e.g. Runn)"
                value={naming() ?? ''}
                ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
                onInput={setNaming}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setNaming(null) } }}
              />
              <Button submit disabled={busy() || !naming()?.trim()}>Create and move</Button>
              <Button variant="bare" onPress={() => setNaming(null)}>Cancel</Button>
            </form>
          }
        >
          <Select
            size="sm"
            width="auto"
            label="Move to workspace"
            value=""
            disabled={busy()}
            options={[
              { value: '', label: 'Move to workspace…', disabled: true },
              ...props.workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
              { value: NEW_WORKSPACE, label: 'New workspace…' },
            ]}
            onChange={moveTo}
          />
          <Button
            size="sm"
            disabled={busy()}
            onPress={() => {
              // Read once: the lists refetch before the result is worded, and by then every row has flipped.
              const show = allHidden()
              void each((what) => `${show ? 'Showed' : 'Hid'} ${what}`, (project) => patchProject(project.id, { hidden: !show }))
            }}
          >
            {allHidden() ? 'Show' : 'Hide'}
          </Button>
          <Select
            size="sm"
            width="auto"
            label="Set colour"
            value=""
            disabled={busy()}
            options={[
              { value: '', label: 'Set colour…', disabled: true },
              ...PROJECT_COLOR_OPTIONS,
              { value: 'none', label: 'No colour' },
            ]}
            onChange={(value) => void each((what) => `Recoloured ${what}`, (project) => patchProject(project.id, { color: value === 'none' ? null : value }))}
          />
        </Show>
        <Toolbar.Spacer />
        <Button size="sm" variant="bare" onPress={props.onClear}>Clear</Button>
      </Toolbar>
    </div>
  )
}
