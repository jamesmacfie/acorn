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
    <div class="pane layout-hbf">
      {props.regions.header?.()}
      <div class="layout-hbf-body">{props.regions.body?.()}</div>
      {props.regions.footer?.()}
    </div>
  )
}
