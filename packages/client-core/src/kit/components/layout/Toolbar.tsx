import type { JSX } from 'solid-js'

/* Toolbar: the bar strip. `bar` is the bordered pane strip; `actions` is the borderless
   end-aligned form or modal footer. No arrow-key roving, because most of these mix inputs and
   buttons, where roving hurts. Not for tab strips or the topbar, which have their own semantics. */
export type ToolbarProps =
  | {
      variant?: 'bar' | 'actions'
      size?: 'sm' | 'md'
      ariaLabel?: string
      children: JSX.Element
    }
  | {
      /** A compact fact strip. Only `secondary` yields to a narrow container. */
      variant: 'status'
      size?: 'sm' | 'md'
      ariaLabel?: string
      primary: JSX.Element
      secondary?: JSX.Element
      essential: JSX.Element
      actions?: JSX.Element
      children?: never
    }

export function Toolbar(props: ToolbarProps) {
  const variant = () => props.variant ?? 'bar'
  return (
    <div
      class="ui-toolbar"
      data-variant={variant()}
      data-size={props.size ?? 'md'}
      role={variant() === 'actions' ? undefined : 'toolbar'}
      aria-label={variant() === 'actions' ? undefined : props.ariaLabel}
    >
      {props.variant === 'status' ? (
        <>
          <span class="ui-toolbar-status-primary">{props.primary}</span>
          <span class="ui-toolbar-status-secondary">{props.secondary}</span>
          <span class="ui-toolbar-status-essential">{props.essential}</span>
          <span class="ui-toolbar-status-actions">{props.actions}</span>
        </>
      ) : (
        props.children
      )}
    </div>
  )
}

/** flex:1 filler, in place of the `margin-left: auto` idiom. */
/** The gap that pushes what follows to the far end of the bar. A name of its own as well as
 *  `Toolbar.Spacer`, because a remote tree names one type per node and has nowhere to put the dot. */
export const ToolbarSpacer = () => <span class="ui-toolbar-spacer" />

Toolbar.Spacer = ToolbarSpacer

/** A gap-tightened cluster, for pairs that read as one control (a find bar's prev/next). `joined`
 *  closes the gap and shares the border between the buttons, so a button and the menu beside it
 *  draw as one split button without the kit having a node for one (docs/diff-rendering.md). */
Toolbar.Group = (props: { joined?: boolean; children: JSX.Element }) => (
  <span class="ui-toolbar-group" data-joined={props.joined ? '' : undefined}>
    {props.children}
  </span>
)
