import { children, Show, type JSX } from 'solid-js'
import { safeContentHref } from '@acorn/protocol/externalUrl.ts'
import { Spinner } from '../content/Spinner'
import { isExternal } from '../content/isExternal'
import type { Size, Tone } from '../../tokens/tokens'

/** The delegated tooltip, as props rather than attributes. See docs/ui-design.md § Tooltips: the
 *  contract is still data attributes on the element, but only the kit writes them now. */
type Tipped = {
  tip?: string
  /** The second line: what happens, where the tip's first line is what it is. */
  tipSub?: string
  /** A chord to show beside it. */
  tipKey?: string
}

// `title` becomes the app's tip when no `tip` is given, so a button never shows the browser's own
// tooltip beside the styled one.
const tipAttrs = (own: Tipped & { title?: string }) => {
  const text = own.tip ?? own.title
  return {
    'data-tip': text,
    'data-tip-sub': text ? own.tipSub : undefined,
    'data-tip-key': text ? own.tipKey : undefined,
  }
}

/* Button: the action buttons only. Rows, tabs, tree nodes and popover triggers that happen to be
   <button> belong to Row, Tabs, or Picker instead. */
export type ButtonProps = Tipped & {
  /** The accessible name, and the visible one when the button has nothing inside it. An icon-only
   *  button has both: the glyph as its child and the words here. */
  label?: string
  variant?: 'solid' | 'outline' | 'ghost' | 'bare'
  tone?: Extract<Tone, 'neutral' | 'accent' | 'warn' | 'danger'>
  /** `xs` is the chrome-badge size: a glyph affordance inside a topbar strip. */
  size?: Extract<Size, 'xs' | 'sm' | 'md'>
  iconOnly?: boolean
  busy?: boolean
  disabled?: boolean
  /** The long form of the label, on hover. Drawn as the tip when `tip` is not given; kept because
   *  plugins pass it. */
  title?: string
  /** Submits the form it sits in. A button that is not told to submit does not. */
  submit?: boolean
  autofocus?: boolean
  hidden?: boolean
  id?: string
  /** Held in rather than pressed and released: a toggle. ToggleButton is the pair of this and the
   *  handler; a call site holding the state elsewhere sets it directly. */
  pressed?: boolean
  /** Armed to confirm, where the armed state lives outside one button — a group header arming a row
   *  key. ConfirmButton is the single-button case. */
  armed?: boolean
  /** Opens a menu or a listbox, and whether it is open. Both are announced; neither is styling. */
  opens?: 'menu' | 'listbox' | 'dialog'
  expanded?: boolean
  describedBy?: string
  /** Renders an <a class="ui-btn">. A control that navigates is a link, not a button: middle-click,
   *  copy-link, and screen-reader semantics depend on it. `target` and `rel` come from the host. */
  href?: string
  onPress?: () => void
  children?: JSX.Element
}

const buttonAttrs = (own: ButtonProps) => ({
  class: 'ui-btn',
  ...tipAttrs(own),
  'data-variant': own.variant ?? 'outline',
  'data-tone': own.tone ?? 'neutral',
  'data-size': own.size ?? 'md',
  'data-icon-only': own.iconOnly ? '' : undefined,
  'data-busy': own.busy ? '' : undefined,
  'data-armed': own.armed ? '' : undefined,
  'data-pressed': own.pressed ? '' : undefined,
  'aria-busy': own.busy ? ('true' as const) : undefined,
  'aria-pressed': own.pressed,
  'aria-label': own.label,
  'aria-haspopup': own.opens,
  'aria-expanded': own.expanded,
  'aria-describedby': own.describedBy,
  id: own.id,
  hidden: own.hidden,
})

export function Button(props: ButtonProps) {
  const safeHref = () => safeContentHref(props.href)
  // Read once, for the reason on RowParts: testing `props.children` and then inserting it built an
  // icon button's mark twice.
  const content = children(() => props.children)
  // The label doubles as the visible text, so a call site that has only words never writes them
  // twice. A remote tree hands every node its children as a list, empty when there are none, and an
  // empty list is truthy, so "has content" means a child that draws something.
  const hasContent = () => content.toArray().some((child) => child != null && child !== '' && typeof child !== 'boolean')
  const body = () => (
    <>
      <Show when={props.busy}><Spinner size="sm" /></Show>
      <Show when={hasContent()} fallback={props.label}>{content()}</Show>
    </>
  )
  return (
    <Show
      when={safeHref()}
      fallback={
        <button
          {...buttonAttrs(props)}
          type={props.submit ? 'submit' : 'button'}
          autofocus={props.autofocus}
          disabled={props.disabled || props.busy}
          onClick={() => props.onPress?.()}
        >
          {body()}
        </button>
      }
    >
      {(href) => (
        <a
          {...buttonAttrs(props)}
          href={href()}
          target={isExternal(href()) ? '_blank' : undefined}
          rel={isExternal(href()) ? 'noopener noreferrer' : undefined}
          onClick={() => props.onPress?.()}
        >
          {body()}
        </a>
      )}
    </Show>
  )
}
