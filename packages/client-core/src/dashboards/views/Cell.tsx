import { createMemo, Match, Switch } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PluginCollectionCell, PluginCollectionField } from '@acorn/protocol/collections.ts'
import { openInAppUrl } from '../../registries/contentLinks'
import { activeTaskId } from '../../tasks/tasks'
import { StatusDot } from '../../ui/primitives'
import { formatCell, type FormattedCell } from '../format'

// One cell, drawn BY ITS SEMANTIC FIELD TYPE. Every decision worth testing is in `formatCell`; this
// file is the JSX for its answers and nothing else — vitest here cannot render a Solid component, so
// anything that lived here would be unchecked.

export default function Cell(props: { field: PluginCollectionField; value: PluginCollectionCell | undefined }) {
  const cell = createMemo(() => formatCell(props.field, props.value))
  const navigate = useNavigate()
  // Narrows the union for `Match`, which cannot do it from a `kind ===` comparison on its own.
  const of = <K extends FormattedCell['kind']>(kind: K) => (): Extract<FormattedCell, { kind: K }> | undefined => {
    const value = cell()
    return value.kind === kind ? value as Extract<FormattedCell, { kind: K }> : undefined
  }

  return (
    // An em dash, not a blank: "this row has no value here" is a fact worth showing, and it is a
    // different fact from an empty string (@acorn/protocol/collections.ts).
    <Switch fallback={<span class="muted">—</span>}>
      <Match when={of('enum')()}>
        {(value) => (
          <span class="dash-cell-enum">
            <StatusDot tone={value().tone} />
            {value().label}
          </span>
        )}
      </Match>
      <Match when={of('datetime')()}>
        {/* The age is what a person reads at a glance and the absolute time is what they check, so
            one is the label and the other is the tooltip. */}
        {(value) => <span class="dash-cell-time" title={value().absolute}>{value().relative}</span>}
      </Match>
      <Match when={of('link')()}>
        {(value) => (
          <a
            class="dash-cell-link"
            href={value().url}
            target="_blank"
            rel="noopener noreferrer"
            // The row around this one has its own declared action; a link click is not that click.
            // The href stays the real external URL — it is what a middle-click, a copy-link and a
            // modified click should all give — and only a plain left click is taken, and only when the
            // URL names something acorn has a surface for (registries/contentLinks.ts § openInAppUrl).
            onClick={(event) => {
              event.stopPropagation()
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              if (openInAppUrl(value().url, { taskId: activeTaskId(), prefer: 'route', navigate })) event.preventDefault()
            }}
          >
            {value().text}
          </a>
        )}
      </Match>
      <Match when={of('number')()}>{(value) => <span class="dash-cell-number">{value().text}</span>}</Match>
      {/* A name. An avatar wants a resolved account, and `person` is a display string. */}
      <Match when={of('person')()}>{(value) => <span>{value().name}</span>}</Match>
      <Match when={of('boolean')()}>{(value) => <span>{value().text}</span>}</Match>
      <Match when={of('text')()}>{(value) => <span>{value().text}</span>}</Match>
    </Switch>
  )
}
