import { createMemo, Match, Show, Switch } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PluginCollectionCell, PluginCollectionField } from '@acorn/protocol/collections.ts'
import { openInAppUrl } from '../../registries/contentLinks'
import { activeTaskId } from '../../tasks/tasks'
import { StatusDot } from '../../ui/primitives'
import { formatCell, type FormattedCell } from '../format'

// One cell, drawn by its semantic field type. Every decision worth testing is in `formatCell`; this file
// is the JSX for its answers and nothing else, because vitest here can't render a Solid component.

export default function Cell(props: { field: PluginCollectionField; value: PluginCollectionCell | undefined }) {
  const cell = createMemo(() => formatCell(props.field, props.value))
  const navigate = useNavigate()
  // Narrows the union for `Match`, which can't do it from a `kind ===` comparison on its own.
  const of = <K extends FormattedCell['kind']>(kind: K) => (): Extract<FormattedCell, { kind: K }> | undefined => {
    const value = cell()
    return value.kind === kind ? value as Extract<FormattedCell, { kind: K }> : undefined
  }

  return (
    // An em dash, not a blank: "this row has no value here" is a fact worth showing, and it's a
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
            // The row around this one has its own declared action, and a link click isn't that click.
            // The href stays the real external URL, which is what a middle-click, a copy-link and a
            // modified click should all give. Only a plain left click is taken, and only when the URL
            // names something acorn has a surface for (registries/contentLinks.ts § openInAppUrl).
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
      {/* A monogram plus the name. The mark is derived from the name itself (format.ts §
          personInitials) rather than fetched: `person` is a display string, and a remote avatar
          guessed from it would be a claim the wire never made. A name with no letters in it drops
          the mark and renders as plain text. */}
      <Match when={of('person')()}>
        {(value) => (
          <span class="dash-cell-person">
            <Show when={value().initials}>
              {(initials) => <span class="dash-cell-avatar" aria-hidden="true">{initials()}</span>}
            </Show>
            {value().name}
          </span>
        )}
      </Match>
      <Match when={of('boolean')()}>{(value) => <span>{value().text}</span>}</Match>
      <Match when={of('text')()}>{(value) => <span>{value().text}</span>}</Match>
    </Switch>
  )
}
