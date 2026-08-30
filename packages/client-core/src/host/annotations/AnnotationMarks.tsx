import { For, Show } from 'solid-js'
import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import Icon from '../../kit/components/Icon'
import { annotationsFor } from './annotations'
import './annotations.css'

// One item's marks, drawn by the host with the host's own components (docs/plugins.md § Cooperative
// extension points, the `annotation` kind).
//
// The whole of what a contributor gets to say is a severity, a line of text and an icon name. No
// colour, no markup, no click site: a mark is a fact pinned to somebody else's row, and a plugin that
// could put a control there would be putting a control in another plugin's pane.
//
// The plugin id is drawn, not merely recorded, for the reason the row groups draw theirs: a person
// reading "not covered by any test" on their diff is entitled to know which package said so.
export function AnnotationMarks(props: { point: string; itemKey: PluginAnnotationKey }) {
  const marks = () => annotationsFor(props.point, props.itemKey)
  return (
    <Show when={marks().length}>
      <div class="annotation-marks">
        <For each={marks()}>
          {(mark) => (
            <span class="annotation-mark" data-severity={mark.severity}>
              <Show when={mark.icon}>{(name) => <Icon name={name()} />}</Show>
              <span class="annotation-mark-text">{mark.text}</span>
              <span class="muted annotation-mark-owner">{mark.pluginId}</span>
            </span>
          )}
        </For>
      </div>
    </Show>
  )
}
