/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import {
  composeItems, fuzzyFilter, type PaletteItem,
} from '@acorn/client-core/kit/lib/paletteModel.ts'
import {
  paletteRowSources, type PaletteRowSource,
} from '@acorn/client-core/host/registries/palette/paletteRows.ts'
import {
  commandAvailable, commandHint, commandRegistry, commandTitle, executeCommand,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import { hasHostCapability } from '@acorn/client-core/infra/node/hostCapabilities.ts'
import { activeTaskId, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { Modal, ModalBody } from '../kit/grouping'
import { Alert, Row } from '../kit/showing'
import { Input } from '../kit/asking'
import { Line } from '../kit/cells'
import { overlayKeys } from '../keys/trap'
import { takeFocus } from '../keys/regions'
import { closeOverlay } from './state'
import type { ShellModel } from './model'

// The command palette, over the same model the desktop's runs on.
//
// `kit/lib/paletteModel.ts` is the composition and the fuzzy filter and has no DOM in it, so both
// hosts spend it unchanged, and the rows are the registry's — a plugin's palette rows appear here
// exactly as they do on the desktop and go back to their own source to be run.
//
// What does not cross is `PaletteSurface.tsx`, which is a backdrop, a dialog and a `<ul>`. Here the
// surface is a `Modal` holding a filter field and a list, which is what a terminal overlay is
// (docs/tui.md § What is drawn bespoke).
//
// Nor does the cursor come from the kit's collection, and that is the same decision the desktop made
// for the same reason: `createOverlayPalette` handles its own arrows because the input owns the
// typing. In cells the argument is sharper — a collection's keys are bare keys, and a bare key does
// not fire while something is being typed into, which in a palette is always. So the arrows are a
// layer above the trap (../keys/trap.ts § overlayKeys) and the cursor is one signal.

/** How many rows fit under the field. Fixed rather than measured: the modal is drawn where the pane
 *  is and the pane is at least this tall at 80 by 24, which is the size the kit promises. */
const VISIBLE = 12

export function Palette(props: { model: ShellModel }) {
  const [query, setQuery] = createSignal('')
  const [sel, setSel] = createSignal(0)
  const [actionError, setActionError] = createSignal('')
  const close = () => closeOverlay('palette')

  // Every eligible source at once, keyed on the active task, and one failing source contributes an
  // error row rather than taking the list down. The desktop's reasoning, unchanged: a broken
  // run-target fetch must not also hide the pane commands and go-to-task.
  const eligible = () => paletteRowSources().filter((source) => hasHostCapability(source.requires))
  const [contributed] = createResource(
    () => activeTaskId() ?? '',
    (key: string) => {
      const taskId = key || null
      return Promise.all(eligible().map(async (source) => {
        try {
          return { source, result: await source.rows(taskId) }
        } catch (error) {
          return {
            source,
            result: { rows: [], errors: [{ source: source.id, message: error instanceof Error ? error.message : String(error) }] },
          }
        }
      }))
    },
    { initialValue: [] },
  )

  const ownerOf = createMemo(() => {
    const owners = new Map<string, PaletteRowSource>()
    for (const { source, result } of contributed()) for (const row of result.rows) owners.set(row.id, source)
    return owners
  })

  const actions = () => commandRegistry.entries()
    .filter((command) => command.palette && commandAvailable(command))
    .map((command) => ({ id: command.id, label: commandTitle(command), hint: commandHint(command) }))

  const taskRows = () => props.model.allTasks()
    .filter((task) => task.id !== activeTaskId())
    .map((task) => ({ id: task.id, label: `Go to task: ${task.title}`, hint: task.branch ?? task.projectId }))

  const workspaceRows = () => props.model.workspaces()
    .filter((workspace) => workspace.id !== props.model.workspace()?.id)
    .map((workspace) => ({ id: workspace.id, label: `Switch workspace: ${workspace.name}`, hint: `${workspace.projects.length} projects` }))

  const items = createMemo<PaletteItem[]>(() => fuzzyFilter(
    composeItems({
      rows: contributed().flatMap(({ result }) => result.rows),
      errors: contributed().flatMap(({ result }) => result.errors ?? []),
      actions: actions(),
      workspaces: workspaceRows(),
      tasks: taskRows(),
    }),
    query(),
  ))

  // Keep the cursor in range when the list shrinks under it, which typing does on every keystroke.
  createEffect(() => {
    const length = items().length
    if (sel() >= length) setSel(length ? length - 1 : 0)
  })

  // The window follows the cursor rather than a scroll position, the same rule `Rows` keeps: there is
  // no pointer to scroll with, so the keys move the cursor and the view goes where the cursor is.
  const window = createMemo(() => {
    const all = items()
    if (all.length <= VISIBLE) return { from: 0, rows: all }
    const from = Math.min(Math.max(0, sel() - Math.floor(VISIBLE / 2)), all.length - VISIBLE)
    return { from, rows: all.slice(from, from + VISIBLE) }
  })

  async function invoke(item: PaletteItem): Promise<void> {
    setActionError('')
    if (item.kind === 'error') return // visible, not invocable
    close()
    if (item.kind === 'task') {
      const task = props.model.allTasks().find((row) => row.id === item.id.slice('task:'.length))
      if (task) activateTaskSignals(task)
      return
    }
    if (item.kind === 'workspace') {
      props.model.chooseWorkspace(item.id.slice('workspace:'.length))
      setSelectedSource(null)
      return
    }
    if (item.kind === 'action') {
      await executeCommand(item.id)
      return
    }
    const result = await ownerOf().get(item.id)?.invoke(item, activeTaskId() ?? null)
    if (result?.error) setActionError(result.error)
  }

  const run = (): boolean => {
    const item = items()[sel()]
    if (!item) return true
    void invoke(item).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
    return true
  }
  const move = (delta: 1 | -1): boolean => {
    setSel((at) => Math.min(Math.max(at + delta, 0), Math.max(0, items().length - 1)))
    return true
  }
  overlayKeys([
    { key: 'down', cmd: () => move(1) },
    { key: 'up', cmd: () => move(-1) },
    { key: 'return', cmd: run },
  ])

  return (
    <Modal onDismiss={close} title="Commands" size="wide">
      <ModalBody>
        <box flexDirection="column" ref={(element: BoxRenderable) => takeFocus(element)}>
          <Input
            kind="filter"
            placeholder="Run a command, switch a pane, task or workspace…"
            value={query()}
            onInput={(value) => { setQuery(value); setSel(0) }}
          />
        </box>
        <Show when={actionError()}><Alert>{actionError()}</Alert></Show>
        <For each={window().rows} fallback={<Line role="muted">No matches.</Line>}>
          {(item, index) => (
            <Row
              selected={window().from + index() === sel()}
              leading={window().from + index() === sel() ? '›' : ' '}
              meta={'hint' in item ? item.hint ?? '' : ''}
            >
              {item.label}
            </Row>
          )}
        </For>
      </ModalBody>
    </Modal>
  )
}
