import { children, createUniqueId, Show, type JSX } from 'solid-js'
import { HelpMark } from '../content/HelpMark'

export type SectionHeaderProps = {
  level?: 'pane' | 'group' | 'sub'
  sticky?: boolean
  count?: number
  /** What the section is for, behind a "?" after the label. */
  help?: string
  actions?: JSX.Element
  children: JSX.Element
}

/* SectionHeader. `level` is the role, not the size: 'pane' is the sticky pane header, 'group' a
   list grouping, 'sub' an inline subheading. */
export function SectionHeader(props: SectionHeaderProps) {
  // Emits the existing `.section-header` class rather than a parallel `.ui-*` one: it is already a
  // single shared rule at 18 sites, so a pack can reach it. What this adds is the count and
  // actions slots.
  // Read once, for the reason on RowParts.
  const actions = children(() => props.actions)
  const label = children(() => props.children)
  const labelId = createUniqueId()
  return (
    <div
      class="section-header"
      data-level={props.level ?? 'pane'}
      data-sticky={props.sticky ? '' : undefined}
    >
      <Show when={props.help} fallback={<span class="ui-section-header-label">{label()}</span>}>
        {(help) => (
          <span class="ui-titled">
            <span class="ui-section-header-label" id={labelId}>{label()}</span>
            <HelpMark text={help()} titleId={labelId} />
          </span>
        )}
      </Show>
      <Show when={props.count != null}><span class="ui-section-header-count">{props.count}</span></Show>
      <Show when={actions()}><span class="ui-section-header-actions">{actions()}</span></Show>
    </div>
  )
}
