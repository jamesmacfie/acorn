import { lazy } from 'solid-js'
import type { Task } from '@acorn/client-core/queries.ts'
import type { PaneContribution } from '@acorn/client-core/registries/panes.ts'

const PullDetail = lazy(() => import('../PullDetail'))
const DiffView = lazy(() => import('../DiffView'))

export function PrPane(props: { task: Task }) {
  return (
    <div class="pr-pane-grid">
      <section class="pane pane-mid">
        <div class="section-header">Navigator</div>
        <PullDetail task={props.task} />
      </section>
      <section class="pane pane-right">
        <div class="section-header">Diff</div>
        <DiffView task={props.task} />
      </section>
    </div>
  )
}

export const prPaneContribution: PaneContribution = {
  id: 'pr',
  label: 'PR review',
  glyph: 'git-pull-request',
  description: 'Diff, files & review comments',
  order: 10,
  defaultChord: 'meta+shift+r',
  when: (task) => task.pullNumber != null,
  component: PrPane,
  minWidth: 520,
}
