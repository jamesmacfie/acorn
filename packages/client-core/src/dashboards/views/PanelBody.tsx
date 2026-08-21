import { Match, Switch } from 'solid-js'
import { EmptyState } from '../../ui/primitives'
import BoardView from './BoardView'
import ChartView from './ChartView'
import ListView from './ListView'
import type { PanelViewProps } from './props'
import StatView from './StatView'
import TableView from './TableView'

// The one place a panel's body is drawn, for both the placed panel (Panel.tsx) and the wizard's live
// preview (PanelPreview.tsx). docs/dashboards.md § The generated editor and § Placements cover why
// there is exactly one view switch and what an unresolved view kind falls back to.

export default function PanelBody(props: PanelViewProps) {
  return (
    <Switch
      fallback={(
        <EmptyState align="start" size="sm" title="View unavailable">
          This panel uses a “{props.view.kind}” view, which this version does not draw.
        </EmptyState>
      )}
    >
      <Match when={props.view.kind === 'stat'}><StatView {...props} /></Match>
      <Match when={props.view.kind === 'list'}><ListView {...props} /></Match>
      <Match when={props.view.kind === 'table'}><TableView {...props} /></Match>
      <Match when={props.view.kind === 'board'}><BoardView {...props} /></Match>
      <Match when={props.view.kind === 'chart'}><ChartView {...props} /></Match>
    </Switch>
  )
}
