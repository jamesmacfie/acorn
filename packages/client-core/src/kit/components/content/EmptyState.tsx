import { children, Show, type JSX } from 'solid-js'
import { Spinner } from './Spinner'

/* EmptyState. `busy` folds loading in rather than sitting beside a sibling: "loading...", "no
   data", and "unconfigured, do X" are one box with different contents.

   No illustration library and no built-in reasons. The call site supplies the why, this supplies
   the geometry. See docs/ui-design/states.md § States. */
export function EmptyState(props: {
  icon?: JSX.Element
  title?: string
  action?: JSX.Element
  busy?: boolean
  align?: 'center' | 'start'
  size?: 'sm' | 'md'
  children?: JSX.Element
}) {
  // Read once, for the reason on RowParts. The icon is not read while the spinner stands in for it,
  // so a busy state builds none.
  const icon = children(() => (props.busy ? undefined : props.icon))
  const text = children(() => props.children)
  const action = children(() => props.action)
  return (
    <div
      class="ui-empty"
      data-align={props.align ?? 'center'}
      data-size={props.size ?? 'md'}
      data-busy={props.busy ? '' : undefined}
    >
      <Show when={props.busy} fallback={<Show when={icon()}><span class="ui-empty-icon">{icon()}</span></Show>}>
        <Spinner size="md" />
      </Show>
      <Show when={props.title}><p class="ui-empty-title">{props.title}</p></Show>
      <Show when={text()}><p class="ui-empty-text">{text()}</p></Show>
      <Show when={action()}><span class="ui-empty-action">{action()}</span></Show>
    </div>
  )
}
