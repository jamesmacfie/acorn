import { Show, type JSX } from 'solid-js'
import type { Tone } from '../../tokens/tokens'
import { Button } from '../inputs/Button'

/* Alert. `variant='inline'` is red text with no box; `variant='banner'` is the bordered callout.

   `role` is derived rather than a prop, because three values were in circulation (alert, status,
   none) chosen at random. A danger alert interrupts; everything else is polite. */
export function Alert(props: {
  tone?: Extract<Tone, 'danger' | 'warn' | 'muted' | 'ok'>
  variant?: 'inline' | 'banner'
  title?: string
  actions?: JSX.Element
  onDismiss?: () => void
  children: JSX.Element
}) {
  const tone = () => props.tone ?? 'danger'
  return (
    <div
      class="ui-alert"
      data-tone={tone()}
      data-variant={props.variant ?? 'inline'}
      role={tone() === 'danger' ? 'alert' : 'status'}
    >
      <span class="ui-alert-body">
        <Show when={props.title}><strong class="ui-alert-title">{props.title}</strong></Show>
        {props.children}
      </span>
      <Show when={props.actions}><span class="ui-alert-actions">{props.actions}</span></Show>
      <Show when={props.onDismiss}>
        {/* Keep the literal mark: the terminal host prints Button's label when it cannot read a
            child icon, so an Icon here would widen dismiss to the word "Dismiss". */}
        <Button variant="bare" size="sm" iconOnly label="Dismiss" onPress={() => props.onDismiss?.()}>✕</Button>
      </Show>
    </div>
  )
}
