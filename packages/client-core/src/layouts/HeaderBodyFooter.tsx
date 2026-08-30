import { Show } from 'solid-js'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/regions'
import type { LayoutProps } from './regions'

// `header-body-footer`: a header that does not scroll, a body that does, and a footer that does not.
//
// All three regions are optional, so `header-body` is this layout with no footer rather than a name of
// its own. The body is the focus group; the header and footer join it unless they hold a stop of their
// own, which a `Composer` in the footer does.
//
// Narrow: unchanged, with the footer pinned. Terminal: the same.
export function HeaderBodyFooter(props: LayoutProps) {
  return (
    <div class="pane layout-hbf" use:regionFocus={{ paneId: props.stateKey, regionId: 'body' }}>
      {/* Each strip is a box of its own so the host can inset it. A region's contents are a plugin's
          tree, and a chip row or a summary line sitting flush against the pane's border is the one
          thing a plugin cannot fix from inside (docs/ui-design.md § The closed kit). */}
      <Show when={props.regions.header}><div class="layout-hbf-header">{props.regions.header!()}</div></Show>
      <div class="layout-hbf-body">{props.regions.body?.()}</div>
      <Show when={props.regions.footer}><div class="layout-hbf-footer">{props.regions.footer!()}</div></Show>
    </div>
  )
}
