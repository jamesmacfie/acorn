import { For } from 'solid-js'
import type { PaneSwitcherProps } from '@acorn/protocol/paneSwitcher.ts'
import { RailTab } from '../tabs/RailTab'
import { markersFor } from '../../host/registries/rail/railMarkerFeed'
import { menuPoint } from '../../host/registries/panes/menuPoint'

// Core's provider for the host-owned pane switcher contract. The host keeps layout state and
// shortcuts; a provider only presents the panes and calls the supplied verbs.
export default function PaneSwitcher(props: PaneSwitcherProps) {
  return (
    <For each={props.panes}>
      {(pane) => (
        <RailTab
          label={pane.label}
          glyph={pane.icon}
          active={pane.shown}
          markers={markersFor({ kind: 'pane', id: pane.id, taskId: props.task.id })}
          data-tip-key={pane.shortcut}
          data-tip-sub={pane.description ? `${pane.description}. ⌘-click to open beside.` : '⌘-click to open beside.'}
          aria-pressed={pane.shown}
          onClick={(event) => event.metaKey || event.ctrlKey ? props.add(pane.id) : props.show(pane.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            event.currentTarget.focus()
            props.openContextMenu?.(pane.id, menuPoint(event))
          }}
        />
      )}
    </For>
  )
}
