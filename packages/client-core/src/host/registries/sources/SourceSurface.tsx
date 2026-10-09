import { createEffect, createRenderEffect, on, onCleanup, Show, Suspense, type Component } from 'solid-js'
import { DetailColumn, ListColumn, ListDetail } from '../../../kit/components/primitives'
import { ContributionBoundary } from '../../../kit/components/content/ContributionBoundary'
import { RegionLoading } from '../../layouts/RegionLoading'
import { featureMounted, openFeature } from '../../../infra/telemetry/featureOpening'
import { sourceRegistry, type SourceContribution } from './sources'

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
  // No source reports usable content, so its opening is a mount proxy
  // (docs/telemetry/renderer.md § Feature openings). Keyed on the id rather than on this component,
  // because switching sources hands this same component a new source. The render effect opens the
  // record before the surface draws, and the effect closes it once the surface has mounted.
  const sourceId = () => props.source.id
  createRenderEffect(on(sourceId, (id) => onCleanup(openFeature(id, sourceRegistry.ownerOf(id) ?? 'core', { kind: 'source', reportsUsable: false }))))
  createEffect(on(sourceId, featureMounted))
  return (
    <Show when={props.source.regions} fallback={
      <Show when={props.source.component}>
        {(component) => <SourceRegion source={props.source} component={component()} />}
      </Show>
    }>
      {(regions) => (
        // Keyed by the source, so collapsing GitHub's list leaves Linear's alone and each comes back
        // where it was left (kit/lib/layout/collapseState.ts). Every source that hands over two halves is a
        // list beside a detail, so none of them has to ask for the control.
        <ListDetail split collapseKey={props.source.id}>
          <ListColumn>
            <SourceRegion source={props.source} component={regions().list} />
          </ListColumn>
          <DetailColumn scroll={regions().scroll} measure={regions().measure}>
            <SourceRegion source={props.source} component={regions().detail} />
          </DetailColumn>
        </ListDetail>
      )}
    </Show>
  )
}

/**
 * One part of a source under boundaries of its own, so a list that fails or is still loading leaves
 * the detail beside it alone. Keyed on the component: a boundary that has drawn never shows its
 * placeholder again (patches/README.md), and a source switch hands this the next source's component.
 */
function SourceRegion(props: { source: SourceContribution; component: Component }) {
  return (
    <Show when={props.component} keyed>
      {(Region) => (
        <ContributionBoundary contributionId={props.source.id} owner={sourceRegistry.ownerOf(props.source.id)}>
          <Suspense fallback={<RegionLoading label={props.source.label} />}>
            <Region />
          </Suspense>
        </ContributionBoundary>
      )}
    </Show>
  )
}
