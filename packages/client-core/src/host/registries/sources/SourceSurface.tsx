import { Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { DetailColumn, ListColumn, ListDetail } from '../../../kit/components/primitives'
import type { SourceContribution } from './sources'

// A browse source on screen, whichever way it declared itself.
//
// Two shapes reach this: the old one, a single `component` that draws the whole surface and its own
// split; and the new one, `regions`, where the source names its list and its detail separately so a
// host can put them in different places (./sources.ts § regions).
//
// On this host they end up drawing the same thing, and that is the point. A source that moves to
// `regions` must not change on the desktop — the rendering below is the `ListDetail split` the
// migrated sources used to write by hand, character for character — so the only host that sees a
// difference is the one that asked for the field. The terminal reads `regions` itself and never calls
// this, because it draws the two halves in two different panels (apps/tui/src/chrome/Shell.tsx).
export function SourceSurface(props: { source: SourceContribution }) {
  return (
    <Show when={props.source.regions} fallback={
      <Show when={props.source.component}>
        {(component) => <Dynamic component={component()} />}
      </Show>
    }>
      {(regions) => (
        <ListDetail split>
          <ListColumn>
            <Dynamic component={regions().list} />
          </ListColumn>
          <DetailColumn>
            <Dynamic component={regions().detail} />
          </DetailColumn>
        </ListDetail>
      )}
    </Show>
  )
}
