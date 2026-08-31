/** @jsxImportSource @opentui/solid */
import { createComponent, ErrorBoundary, Show, Suspense } from 'solid-js'
import type { Task } from '@acorn/client-core/infra/queries.ts'
import { Tabs } from '../kit/grouping'
import { Line } from '../kit/cells'
import { Alert, EmptyState } from '../kit/showing'
import { panesFor, showPane, shownPane } from './panes'

// The pane row: one line of pane labels, and the pane under it.
//
// `Tabs`-shaped rather than a `Tabs` layout: this is the strip the desktop draws as the pane switcher
// (features/tasks/TaskPaneHost.tsx), and it will stop being bespoke when
// `docs/future/client-plugins/04-replaceable-surfaces.md` makes `pane.switcher` a slot. Until then it
// is core's, and it is already one props object over kit nodes, which is the shape that contract asks
// for.
//
// Two components rather than one, because the shell puts the strip inside a focus region and the pane
// outside it: the strip is a place the keys can be, and the pane's own layout registers its regions
// for itself.

export function PaneStrip(props: { task: Task; focused: boolean }) {
  const panes = () => panesFor(props.task)
  return (
    <box flexDirection="row" gap={1}>
      {/* The caret every collection draws, because the strip is a place the keys can be and nothing
          else on this line would say so: the current pane is already marked, and a mark that means
          two things means neither. */}
      <Line tone="accent">{props.focused ? '\u203a' : ' '}</Line>
      <Tabs
        idPrefix="chrome.panes"
        ariaLabel="Task panes"
        tabs={panes().map((pane) => ({ id: pane.id, label: pane.label }))}
        active={shownPane(props.task)?.id ?? ''}
        onChange={(id) => showPane(props.task, id)}
      />
    </box>
  )
}

// The pane itself is the contribution's own component, model root, layout and all — the same object
// the desktop mounts, drawn by this host's layout table (../layouts/index.ts). One error boundary per
// pane, as on the DOM, drawn as an `Alert` in `warn` tone: a pane that throws is one pane with a
// message in it, not a blank terminal (docs/future/terminal/04-rendering.md § Unknown nodes and failed
// trees). `ContributionBoundary` itself is not reused — its fallback is `<section>` and `<strong>`.
export function PaneBody(props: { task: Task }) {
  const shown = () => shownPane(props.task)
  return (
    <Show
      when={shown()}
      fallback={<EmptyState title="No panes available here">Nothing this build can draw is available on this task.</EmptyState>}
    >
      {/* Clipped, not shrunk. A pane taller than the screen is the normal case at 24 rows, and yoga
          answers a height deficit by shrinking every child that will give — so a one-line row shrunk to
          half a line lands on the line above it, and the PR pane came out as two screens interleaved
          character by character. Clipping is the honest answer and it is the one a terminal gives
          (docs/future/terminal/phase-6-panes-sweep.md).
          A scroll box was the other candidate and is refused: its content box is free-sized, so every
          layout that measures its own box to decide whether it is narrow — which all of them do —
          measures a width that is not on screen, and the detail column of a `list-detail` pane never
          draws at all. */}
      {(pane) => (
        <box flexDirection="column" flexGrow={1} overflow="hidden">
          <ErrorBoundary fallback={(error) => (
            <Alert tone="warn" title={pane().id}>{error instanceof Error ? error.message : String(error)}</Alert>
          )}>
            {/* Under a `Suspense`, because a pane whose contribution is a bare component rather than a
                set of regions is a `lazy()` this host mounts itself, and a pending `lazy()` resolves to
                an empty string — which a cell host refuses outright where the DOM would have drawn a
                text node nobody sees (findings.md § A pending `lazy()` region is an empty string). The
                layout mount path already has this guard; a component pane does not go through it. */}
            <Suspense fallback={null}>
              {createComponent(pane().component, { get task() { return props.task } })}
            </Suspense>
          </ErrorBoundary>
        </box>
      )}
    </Show>
  )
}
