// Which pane a task is showing, and how the pane chords move between them.
//
// A terminal shows one pane. The desktop's row of panes side by side needs pixels to be worth
// anything — two panes at 80 cells are two 40-cell columns, and `docs/ui-design.md`'s own floor is
// that a pane reads at 80 — so the honest projection of "a left-to-right row of panes" is a strip of
// labels and one pane under it (docs/tui.md § The screen).
//
// So `nextPane` and `prevPane` walk the switcher's list rather than a row of mounted panes, and
// choosing one is the reducer's own `show`, which is what a plain click is on the desktop. Nothing
// here invents a second layout state: `layoutForTask` stays the durable truth on both hosts, and a
// task opened in the app afterwards finds the pane this shell left it on.

import { dispatchLayout, layoutForTask, activeTaskId } from '@acorn/client-core/features/tasks/tasks.ts'
import { defaultLayout } from '@acorn/client-core/features/tasks/taskLayout.ts'
import {
  paneAvailable, paneContribution, paneContributions, type PaneContribution,
} from '@acorn/client-core/host/registries/panes/panes.ts'
import type { Task } from '@acorn/client-core/infra/queries.ts'

/** Every pane this task can show, in registry order. The strip's contents. */
export const panesFor = (task: Task): PaneContribution[] =>
  paneContributions().filter((pane) => paneAvailable(pane, task))

/**
 * The pane on screen: the first one in the task's saved layout that this build can draw, else the
 * first the task offers at all.
 *
 * The fallback is not cosmetic. `DEFAULT_PANE` is the PR pane, and a task on a project with no GitHub
 * remote has no PR — the same hole `TaskPaneHost` fills the same way.
 */
export function shownPane(task: Task): PaneContribution | undefined {
  const layout = layoutForTask(task.id) ?? defaultLayout()
  for (const id of layout.panes) {
    const pane = paneContribution(id)
    if (pane && paneAvailable(pane, task)) return pane
  }
  return panesFor(task)[0]
}

/** Show one. The reducer keeps pinned panes, which on this host means they stay in the row a desktop
 *  would draw them in; only the first is on screen here. */
export const showPane = (task: Task, paneId: string): void =>
  dispatchLayout(task.id, { type: 'show', pane: paneId })

/**
 * The pane chords, as the shell answers them. Wraps, and refuses when there is nothing to move to so
 * the intent bubbles rather than looking broken.
 */
export function cyclePane(task: Task | null, delta: 1 | -1): boolean {
  if (!task || task.id !== activeTaskId()) return false
  const panes = panesFor(task)
  if (panes.length < 2) return false
  const current = shownPane(task)
  const at = panes.findIndex((pane) => pane.id === current?.id)
  const next = panes[(((at < 0 ? 0 : at) + delta) + panes.length) % panes.length]
  if (!next) return false
  showPane(task, next.id)
  return true
}
