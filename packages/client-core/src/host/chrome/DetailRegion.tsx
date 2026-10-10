import { Show } from 'solid-js'
import type { DetailRegionProps } from '@acorn/protocol/extensionPoints.ts'
import { Slot } from '../tree/Slot'
import { detailMountKey } from './extendedPane'

// One region a loaded owner mounted above or below its detail view (docs/plugins/detail-regions.md).
// The host draws it as a sibling of the owner's tree, so the owner's tree opens no slot and keeps its
// own scrolling. The region scrolls on its own and is capped, so contributors can't push the owner's
// view off the screen. With no contributor it is empty and draws nothing.
export function DetailRegion(props: { point: string; region: 'header' | 'footer'; subject: () => DetailRegionProps }) {
  return (
    <Show when={detailMountKey(props.subject())} keyed>
      {(_key) => (
        <div class="detail-region" data-region={props.region}>
          <Slot
            point={props.point}
            props={props.subject}
            {...(props.subject().projectId ? { projectId: props.subject().projectId } : {})}
          />
        </div>
      )}
    </Show>
  )
}
