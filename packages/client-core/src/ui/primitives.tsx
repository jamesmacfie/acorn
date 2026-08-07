import { Show, splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cx } from './cx'
import Icon from './Icon'

/* ── Button ──────────────────────────────────────────────────────────────────────────────────
   Replaces the action buttons only. Rows, tabs, tree nodes and popover triggers that happen to be
   <button> belong to Row/Tabs/Picker, not here — forcing them through Button is what makes a
   primitive layer feel like a straitjacket. */
export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'solid' | 'outline' | 'ghost' | 'bare'
  tone?: 'neutral' | 'accent' | 'danger' | 'warn'
  size?: 'sm' | 'md'
  iconOnly?: boolean
  busy?: boolean
}

export function Button(props: ButtonProps) {
  const [own, rest] = splitProps(props, ['variant', 'tone', 'size', 'iconOnly', 'busy', 'class', 'children'])
  return (
    <button
      {...rest}
      type={props.type ?? 'button'}
      class={cx('ui-btn', own.class)}
      data-variant={own.variant ?? 'outline'}
      data-tone={own.tone ?? 'neutral'}
      data-size={own.size ?? 'md'}
      data-icon-only={own.iconOnly ? '' : undefined}
      data-busy={own.busy ? '' : undefined}
      aria-busy={own.busy ? 'true' : undefined}
      disabled={rest.disabled || own.busy}
    >
      <Show when={own.busy}><Spinner size="sm" /></Show>
      {own.children}
    </button>
  )
}

/* ── Form controls ───────────────────────────────────────────────────────────────────────────
   `.integration-key-input` was the de-facto shared input — 33 uses across 11 files, defined in an
   *integrations* stylesheet and reached for by settings pages, the tab rail and two plugins. */
type ControlOwn = { size?: 'sm' | 'md'; invalid?: boolean; width?: 'full' | 'auto' | 'narrow' }

const controlAttrs = (own: ControlOwn & { class?: string }) => ({
  class: cx('ui-input', own.class),
  'data-size': own.size ?? 'md',
  'data-width': own.width ?? 'full',
  'data-invalid': own.invalid ? '' : undefined,
  'aria-invalid': own.invalid ? ('true' as const) : undefined,
})

export function Input(props: ComponentProps<'input'> & ControlOwn) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'class'])
  return <input {...rest} {...controlAttrs(own)} />
}

export function Select(props: ComponentProps<'select'> & ControlOwn) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'class'])
  return <select {...rest} {...controlAttrs(own)} />
}

export function Textarea(props: ComponentProps<'textarea'> & ControlOwn) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'class'])
  return <textarea {...rest} {...controlAttrs(own)} />
}

/** Label + control + optional hint/error. Replaces `.settings-field` / `.settings-label`. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  layout?: 'stack' | 'row'
  class?: string
  children: JSX.Element
}) {
  return (
    <label class={cx('ui-field', props.class)} data-layout={props.layout ?? 'stack'}>
      <Show when={props.label}><span class="ui-field-label">{props.label}</span></Show>
      {props.children}
      <Show when={props.hint}><span class="ui-field-hint">{props.hint}</span></Show>
      <Show when={props.error}><span class="ui-field-error" role="alert">{props.error}</span></Show>
    </label>
  )
}

/* ── Badge ───────────────────────────────────────────────────────────────────────────────────
   `shape='tag'` is the aesthetic default (a pack may round it); `shape='pill'` is semantic — a
   capsule in every pack. `dashed` exists because the Database example-picker's "add" chip is the
   codebase's only non-solid border and would otherwise stay a one-off. */
export function Badge(props: {
  tone?: 'neutral' | 'accent' | 'add' | 'del' | 'warn'
  shape?: 'tag' | 'pill'
  size?: 'xs' | 'sm'
  dashed?: boolean
  class?: string
  children: JSX.Element
}) {
  return (
    <span
      class={cx('ui-badge', props.class)}
      data-tone={props.tone ?? 'neutral'}
      data-shape={props.shape ?? 'tag'}
      data-size={props.size ?? 'sm'}
      data-dashed={props.dashed ? '' : undefined}
    >
      {props.children}
    </span>
  )
}

/* ── Spinner ─────────────────────────────────────────────────────────────────────────────────
   Busy state at seven sites: a Lucide loader ring plus the .spin keyframe. The rotation stays on the
   wrapper span, not the svg, so a pack can swap the mark without touching the animation. */
export function Spinner(props: { size?: 'sm' | 'md'; label?: string }) {
  return (
    <span class="ui-spinner spin" data-size={props.size ?? 'sm'} role="status" aria-label={props.label ?? 'Working'}>
      <Icon name="loader-circle" />
    </span>
  )
}

/* ── SectionHeader ───────────────────────────────────────────────────────────────────────────
   `level` is the role, not the size: 'pane' is the sticky pane header, 'group' a list grouping,
   'sub' an inline subheading. One selector per pack turns uppercase-tracked-mono into Modern's
   sentence case or Cozy's serif. */
export function SectionHeader(props: {
  level?: 'pane' | 'group' | 'sub'
  sticky?: boolean
  count?: number
  actions?: JSX.Element
  class?: string
  children: JSX.Element
}) {
  // Emits the EXISTING `.section-header` class rather than a parallel `.ui-*` one: that class is
  // already a single shared rule used at 18 sites, so a pack can reach it today. Duplicating it
  // would mean two rules doing one job. The primitive's value here is the count/actions slots.
  return (
    <div
      class={cx('section-header', props.class)}
      data-level={props.level ?? 'pane'}
      data-sticky={props.sticky ? '' : undefined}
    >
      <span class="ui-section-header-label">{props.children}</span>
      <Show when={props.count != null}><span class="ui-section-header-count">{props.count}</span></Show>
      <Show when={props.actions}><span class="ui-section-header-actions">{props.actions}</span></Show>
    </div>
  )
}

/* ── Row ─────────────────────────────────────────────────────────────────────────────────────
   Navigational list rows. This is the primitive with the most STRUCTURAL style leverage: Terminal
   is a full-bleed square dense row with a 3px left accent bar, Modern an inset rounded card, Cute
   a pill — differences no token substitution can express across 18 separate `-row` selectors.
   Also absorbs the role/tabindex/Enter/Space wiring that DockerBrowse hand-writes twice.

   Deliberately NOT for the virtualized/tabular rows (.diff-row, .dbgrid-row, …): those are
   measured geometry where a changed box model silently corrupts scroll math. */
export function Row(props: {
  selected?: boolean
  nested?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onActivate?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  title?: string
  class?: string
  children: JSX.Element
}) {
  const activate = () => props.onActivate?.()
  return (
    <div
      class={cx('ui-row', props.class)}
      data-selected={props.selected ? '' : undefined}
      data-nested={props.nested ? '' : undefined}
      data-density={props.density ?? 'default'}
      title={props.title}
      role={props.onActivate ? 'button' : undefined}
      tabindex={props.onActivate ? 0 : undefined}
      onClick={props.onActivate ? activate : undefined}
      onKeyDown={props.onActivate
        ? (event) => {
          // Only when the row itself has focus — a button nested inside owns its own keys.
          if (event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          activate()
        }
        : undefined}
    >
      <Show when={props.leading}><span class="ui-row-leading">{props.leading}</span></Show>
      <span class="ui-row-body">{props.children}</span>
      <Show when={props.meta}><span class="ui-row-meta">{props.meta}</span></Show>
      <Show when={props.trailing}><span class="ui-row-trailing">{props.trailing}</span></Show>
    </div>
  )
}
