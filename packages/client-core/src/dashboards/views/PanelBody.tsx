import { Match, Switch } from 'solid-js'
import { EmptyState } from '../../ui/primitives'
import BoardView from './BoardView'
import ChartView from './ChartView'
import ListView from './ListView'
import type { PanelViewProps } from './props'
import StatView from './StatView'
import TableView from './TableView'

// THE ONE WAY A PANEL'S BODY IS DRAWN. Two callers: the placed panel (Panel.tsx) and the wizard's
// live preview (PanelPreview.tsx), which is a real rendering of the draft rather than a thumbnail —
// there is exactly one view switch in the app, and this is it.
//
// The fallback is the inert case: a view kind this build cannot draw, written by a client that has
// more of them. Same answer as an unresolved collection — say so, change nothing.

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
