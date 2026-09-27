import { children, Show, type JSX } from 'solid-js'

/* SectionHeader. `level` is the role, not the size: 'pane' is the sticky pane header, 'group' a
   list grouping, 'sub' an inline subheading. */
export function SectionHeader(props: {
  level?: 'pane' | 'group' | 'sub'
  sticky?: boolean
  count?: number
  actions?: JSX.Element
  children: JSX.Element
}) {
  // Emits the existing `.section-header` class rather than a parallel `.ui-*` one: it is already a
  // single shared rule at 18 sites, so a pack can reach it. What this adds is the count and
  // actions slots.
  // Read once, for the reason on RowParts.
  const actions = children(() => props.actions)
  return (
    <div
      class="section-header"
      data-level={props.level ?? 'pane'}
      data-sticky={props.sticky ? '' : undefined}
    >
      <span class="ui-section-header-label">{props.children}</span>
      <Show when={props.count != null}><span class="ui-section-header-count">{props.count}</span></Show>
      <Show when={actions()}><span class="ui-section-header-actions">{actions()}</span></Show>
    </div>
  )
}
