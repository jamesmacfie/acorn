import { createEffect, createSignal, Show, splitProps, type ComponentProps, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createArmedConfirm } from './confirm'
import type { SplitDrag } from './split'
import { cx } from './cx'

/* ── Button ──────────────────────────────────────────────────────────────────────────────────
   Replaces the action buttons only. Rows, tabs, tree nodes and popover triggers that happen to be
   <button> belong to Row/Tabs/Picker, not here — forcing them through Button is what makes a
   primitive layer feel like a straitjacket. */
export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'solid' | 'outline' | 'ghost' | 'bare'
  tone?: 'neutral' | 'accent' | 'danger' | 'warn'
  /** `xs` is the chrome-badge size: a glyph affordance inside a topbar strip. */
  size?: 'xs' | 'sm' | 'md'
  iconOnly?: boolean
  busy?: boolean
  /** Renders an <a class="ui-btn">. A control that NAVIGATES is a link, not a button — middle-click,
   *  copy-link and screen-reader semantics all depend on it. Hand-written at one site before this. */
  href?: string
  target?: string
  rel?: string
}

const buttonAttrs = (own: {
  variant?: ButtonProps['variant']
  tone?: ButtonProps['tone']
  size?: ButtonProps['size']
  iconOnly?: boolean
  busy?: boolean
  class?: string
}) => ({
  class: cx('ui-btn', own.class),
  'data-variant': own.variant ?? 'outline',
  'data-tone': own.tone ?? 'neutral',
  'data-size': own.size ?? 'md',
  'data-icon-only': own.iconOnly ? '' : undefined,
  'data-busy': own.busy ? '' : undefined,
  'aria-busy': own.busy ? ('true' as const) : undefined,
})

export function Button(props: ButtonProps) {
  const [own, rest] = splitProps(props, ['variant', 'tone', 'size', 'iconOnly', 'busy', 'class', 'children', 'href', 'target', 'rel'])
  return (
    <Show
      when={own.href}
      fallback={
        <button {...rest} type={props.type ?? 'button'} {...buttonAttrs(own)} disabled={rest.disabled || own.busy}>
          <Show when={own.busy}><Spinner size="sm" /></Show>
          {own.children}
        </button>
      }
    >
      {(href) => (
        <a href={href()} target={own.target} rel={own.rel} title={rest.title} {...buttonAttrs(own)}>
          {own.children}
        </a>
      )}
    </Show>
  )
}

/* ── Form controls ───────────────────────────────────────────────────────────────────────────
   `.integration-key-input` was the de-facto shared input — 33 uses across 11 files, defined in an
   *integrations* stylesheet and reached for by settings pages, the tab rail and two plugins. */
type ControlOwn = {
  size?: 'sm' | 'md'
  invalid?: boolean
  width?: 'full' | 'auto' | 'narrow'
  /* `filter` is the boxed list-narrowing input (was `.pr-filter`, `.docker-search`, `.notes-filter`,
     `.db-filter`, `.search-input` — seven bespoke rules, three byte-identical). `bare` is the
     borderless underline that heads a palette or popover (was `.palette-input`, `.finder-input`,
     `.repo-picker-filter`). Needing a different look was the whole reason sites hand-rolled
     `.ui-input`'s tokens instead of using it. */
  kind?: 'filter' | 'bare'
}

const controlAttrs = (own: ControlOwn & { class?: string }) => ({
  class: cx('ui-input', own.class),
  'data-size': own.size ?? 'md',
  'data-width': own.width ?? 'full',
  'data-kind': own.kind,
  'data-invalid': own.invalid ? '' : undefined,
  'aria-invalid': own.invalid ? ('true' as const) : undefined,
})

export function Input(props: ComponentProps<'input'> & ControlOwn) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'kind', 'class'])
  return <input {...rest} {...controlAttrs(own)} />
}

export function Select(props: ComponentProps<'select'> & ControlOwn) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'kind', 'class'])
  return <select {...rest} {...controlAttrs(own)} />
}

/** `mono` retires `.settings-script`, the one bespoke code-entry textarea. */
export function Textarea(props: ComponentProps<'textarea'> & ControlOwn & { mono?: boolean }) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'kind', 'mono', 'class'])
  return <textarea {...rest} {...controlAttrs(own)} data-mono={own.mono ? '' : undefined} />
}

/** Label + control + optional hint/error. Replaces `.settings-field` / `.settings-label`.
 *
 *  `group` is for the case a `<label>` cannot hold: SEVERAL controls under one caption, each with a
 *  label of its own (a row of checkboxes). Nested labels are invalid, and the browser's repair is to
 *  point the outer one at the first control — so clicking the caption toggles the first checkbox, which
 *  is a click nobody meant. `role="group"` with the same caption as its accessible name says the true
 *  thing and stays keyboard- and screen-reader-correct. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  /** `stack` is label over control. `row` is label then control, sized to content — an inline chip in a
   *  strip of them. `split` is label LEFT and control at a fixed column RIGHT, which is the one to reach
   *  for in a stack of fields: the control column is the same width for every sibling, so they line up
   *  on both edges instead of each starting wherever its label happened to end. */
  layout?: 'stack' | 'row' | 'split'
  group?: boolean
  class?: string
  children: JSX.Element
}) {
  const inner = (
    <>
      <Show when={props.label}><span class="ui-field-label">{props.label}</span></Show>
      {props.children}
      <Show when={props.hint}><span class="ui-field-hint">{props.hint}</span></Show>
      <Show when={props.error}><span class="ui-field-error" role="alert">{props.error}</span></Show>
    </>
  )
  return (
    <Show
      when={props.group}
      fallback={(
        <label class={cx('ui-field', props.class)} data-layout={props.layout ?? 'stack'}>{inner}</label>
      )}
    >
      <div class={cx('ui-field', props.class)} data-layout={props.layout ?? 'stack'} role="group" aria-label={props.label}>
        {inner}
      </div>
    </Show>
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
      {/* Fixed Lucide loader-circle geometry. Keeping this inline avoids making every Button import
          the generic icon registry and its full icon-node catalogue just for the busy state. */}
      <svg class="glyph" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
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
  /** Indentation level. Generalises `nested` (which is depth 1) for TreeRow. */
  depth?: number
  /** Hide `trailing` until hover or focus. Five stylesheets implemented this separately. */
  reveal?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onActivate?: () => void
  /** Renders an <a class="ui-row">. github's PR rows are links, so they were an <A> with the row's
   *  classes hand-applied — which lost middle-click and copy-link everywhere else. */
  href?: string
  /** Shape story. `stacked` is the multi-line row (rollbar's occurrence list) that had to override
   *  `.ui-row`'s centring three times. */
  variant?: 'default' | 'stacked'
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  title?: string
  class?: string
  children: JSX.Element
}) {
  const activate = () => props.onActivate?.()
  const body = (
    <>
      <Show when={props.leading}><span class="ui-row-leading">{props.leading}</span></Show>
      <span class="ui-row-body">{props.children}</span>
      <Show when={props.meta}><span class="ui-row-meta">{props.meta}</span></Show>
      <Show when={props.trailing}><span class="ui-row-trailing">{props.trailing}</span></Show>
    </>
  )
  if (props.href !== undefined) {
    return (
      <a
        href={props.href}
        class={cx('ui-row', props.class)}
        data-selected={props.selected ? '' : undefined}
        data-depth={props.depth ? String(props.depth) : undefined}
        data-reveal={props.reveal ? '' : undefined}
        data-density={props.density ?? 'default'}
        data-variant={props.variant ?? 'default'}
        title={props.title}
      >
        {body}
      </a>
    )
  }
  return (
    <div
      class={cx('ui-row', props.class)}
      data-selected={props.selected ? '' : undefined}
      data-nested={props.nested ? '' : undefined}
      data-depth={props.depth ? String(props.depth) : undefined}
      data-reveal={props.reveal ? '' : undefined}
      data-density={props.density ?? 'default'}
      data-variant={props.variant ?? 'default'}
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
      {body}
    </div>
  )
}

/* ── Alert ───────────────────────────────────────────────────────────────────────────────────
   The most duplicated pattern in the codebase, and the one place the dependency graph was
   inverted: `.action-error` was used by 32 files (17 in client-core) but DEFINED in the GitHub
   plugin's stylesheet, so disabling that plugin unstyled every error message in the shell.

   `variant='inline'` is `.action-error` class-for-class — red text, no box — so a migrated call
   site renders identically. `variant='banner'` is the bordered callout that `.settings-notice` /
   `.fleet-banner` / `.docker-stale-banner` each invented separately.

   `role` is DERIVED, not a prop: three values were in circulation (alert/status/none) chosen at
   random. A danger alert interrupts, everything else is polite. */
export function Alert(props: {
  tone?: 'danger' | 'warn' | 'info' | 'success'
  variant?: 'inline' | 'banner'
  title?: string
  actions?: JSX.Element
  onDismiss?: () => void
  class?: string
  children: JSX.Element
}) {
  const tone = () => props.tone ?? 'danger'
  return (
    <div
      class={cx('ui-alert', props.class)}
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
        <Button variant="bare" size="sm" iconOnly aria-label="Dismiss" onClick={() => props.onDismiss?.()}>✕</Button>
      </Show>
    </div>
  )
}

/* ── EmptyState ──────────────────────────────────────────────────────────────────────────────
   ~35 sites in ten class vocabularies, three of them borrowing another plugin's stylesheet
   (notes → editor's `.editor-empty`; preview and docker → core's `.workspace-empty-inner`).

   `busy` folds loading into the same component rather than a sibling: rollbar's PageStatus already
   proved "loading…", "no data" and "unconfigured, do X" are one box with different contents.

   Deliberately dumb — no illustration library, no built-in reasons. The call site supplies the
   *why*, which is what docs/ui-design.md asks for; this supplies consistent geometry. */
export function EmptyState(props: {
  icon?: JSX.Element
  title?: string
  action?: JSX.Element
  busy?: boolean
  align?: 'center' | 'start'
  size?: 'sm' | 'md'
  class?: string
  children?: JSX.Element
}) {
  return (
    <div
      class={cx('ui-empty', props.class)}
      data-align={props.align ?? 'center'}
      data-size={props.size ?? 'md'}
      data-busy={props.busy ? '' : undefined}
    >
      <Show when={props.busy} fallback={<Show when={props.icon}><span class="ui-empty-icon">{props.icon}</span></Show>}>
        <Spinner size="md" />
      </Show>
      <Show when={props.title}><p class="ui-empty-title">{props.title}</p></Show>
      <Show when={props.children}><p class="ui-empty-text">{props.children}</p></Show>
      <Show when={props.action}><span class="ui-empty-action">{props.action}</span></Show>
    </div>
  )
}

/* ── StatusDot ───────────────────────────────────────────────────────────────────────────────
   Drawn ten independent times with TWO competing colour vocabularies: docker used
   --state-ok/warn/bad while agents' identical dots used --add-marker/--warn/--del-marker. This
   settles on the status trio — they read as status, which is what this is, and they already exist
   as derived theme tokens so no theme block needs restating.

   Tones are semantic, not domain states: the call site maps running→ok, exited→muted, failed→bad.
   No children — a dot with a label beside it is Row/Badge composition, not a layout component. */
export function StatusDot(props: {
  /* `mixed` (half-bad, half-warn) is here rather than left to a call-site class because TWO
     independent owners render it — core's rail status and github's PR rows — so a local rule would
     have to live in one of them and be reached for by the other. That is the inversion this
     migration exists to remove. */
  tone: 'ok' | 'warn' | 'bad' | 'muted' | 'accent' | 'mixed'
  pulse?: boolean
  label?: string
  size?: 'sm' | 'md'
  class?: string
}) {
  return (
    <span
      class={cx('ui-dot', props.class)}
      data-tone={props.tone}
      data-size={props.size ?? 'sm'}
      data-pulse={props.pulse ? '' : undefined}
      role={props.label ? 'status' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    />
  )
}

/* ── Checkbox ────────────────────────────────────────────────────────────────────────────────
   The one control class no style pack could reach: every checkbox in the app was a raw
   <input type="checkbox"> with a hand-rolled label wrapper, twice with an inline padding-left
   nesting hack.

   Styles the NATIVE input — `accent-color` gets 90% of the way and keeps native keyboard and
   screen-reader behaviour. Rebuilding the control out of divs is how a checkbox stops being
   announced as one. `switch` is presentation on the same element and the same events, so it is a
   prop rather than a second component. */
export function Checkbox(props: ComponentProps<'input'> & {
  label?: JSX.Element
  hint?: string
  indeterminate?: boolean
  switch?: boolean
  size?: 'sm' | 'md'
  nested?: boolean
}) {
  const [own, rest] = splitProps(props, ['label', 'hint', 'indeterminate', 'switch', 'size', 'nested', 'class'])
  let ref: HTMLInputElement | undefined
  // Tri-state cannot be expressed as an attribute — it is a DOM property only. One site needed it
  // (AgentToolsSettings) and hand-wrote this effect.
  createEffect(() => {
    if (ref) ref.indeterminate = !!own.indeterminate
  })
  const input = (
    <input
      {...rest}
      ref={(el) => { ref = el }}
      type="checkbox"
      class={cx('ui-check-box', own.label ? undefined : own.class)}
      role={own.switch ? 'switch' : undefined}
    />
  )
  return (
    <Show when={own.label} fallback={input}>
      <label
        class={cx('ui-check', own.class)}
        data-size={own.size ?? 'md'}
        data-switch={own.switch ? '' : undefined}
        data-nested={own.nested ? '' : undefined}
      >
        {input}
        <span class="ui-check-label">
          {own.label}
          <Show when={own.hint}><small class="ui-check-hint">{own.hint}</small></Show>
        </span>
      </label>
    </Show>
  )
}

/* ── ConfirmButton ───────────────────────────────────────────────────────────────────────────
   Arm-to-confirm, which this codebase converged on organically in five places and then
   implemented five different ways — three of them smuggling the prompt through the *error*
   channel ("Click discard again…"), which puts a red banner on a UI that has no error.

   The armed button IS the prompt. Frame-safe by construction: no window.confirm, which a
   sandboxed frame silently returns false from (the reason http had to build this itself).

   `skipConfirm` exists for docker's `confirmDestructive` pref gate. Where the armed state must
   live outside one button (a group header arming a row key), use createArmedConfirm directly. */
export function ConfirmButton(props: ButtonProps & {
  confirmLabel?: string
  timeoutMs?: number
  skipConfirm?: boolean
  onConfirm: () => void
}) {
  const [own, rest] = splitProps(props, ['confirmLabel', 'timeoutMs', 'skipConfirm', 'onConfirm', 'children', 'tone', 'onClick', 'onBlur'])
  const armed = createArmedConfirm(() => own.timeoutMs ?? 3000)
  return (
    <Button
      {...rest}
      tone={armed.armed() ? 'danger' : own.tone}
      data-armed={armed.armed() ? '' : undefined}
      onClick={() => {
        if (own.skipConfirm || armed.request('self')) own.onConfirm()
      }}
      onBlur={() => armed.disarm()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && armed.armed()) {
          event.preventDefault()
          armed.disarm()
        }
      }}
    >
      <Show when={armed.armed()} fallback={own.children}>
        {/* Announced, not just recoloured: the label is the entire signal that a second click commits. */}
        <span aria-live="polite">{own.confirmLabel ?? 'Sure?'}</span>
      </Show>
    </Button>
  )
}

/* ── Kbd ─────────────────────────────────────────────────────────────────────────────────────
   A key cap. Three separate rules existed (`.rail-tip-key`, `.help-key`, `.plugin-trust-escape kbd`,
   plus onboarding's `<kbd>`), all mono + --bg-subtle + --control-border, in a keyboard-first app
   whose docs list ⌘K/⌘P/⌘1-9 as core interactions.

   The subtlety worth keeping from rail-tips.css: a cap must not grow the line-height of the row it
   sits in, so its height is fixed and the glyph is centred. */
export function Kbd(props: { size?: 'xs' | 'sm'; class?: string; children: JSX.Element }) {
  return <kbd class={cx('ui-kbd', props.class)} data-size={props.size ?? 'sm'}>{props.children}</kbd>
}

/* ── Toolbar ─────────────────────────────────────────────────────────────────────────────────
   The bar strip, drawn at least fifteen times: flex row + gap + border-bottom + --bg-subtle. Almost
   no behaviour and high leverage — before this, a style pack had zero say over fifteen separately
   authored bars, so a density pack could not compress any of them.

   `bar` is the bordered pane strip; `actions` is the borderless end-aligned form/modal footer.
   Deliberately no arrow-key roving: most of these mix inputs and buttons, where roving hurts.
   Not for tab strips (own semantics) or the topbar (shell chrome on a grid). */
export function Toolbar(props: {
  variant?: 'bar' | 'actions'
  size?: 'sm' | 'md'
  ariaLabel?: string
  class?: string
  children: JSX.Element
}) {
  const variant = () => props.variant ?? 'bar'
  return (
    <div
      class={cx('ui-toolbar', props.class)}
      data-variant={variant()}
      data-size={props.size ?? 'md'}
      role={variant() === 'bar' ? 'toolbar' : undefined}
      aria-label={variant() === 'bar' ? props.ariaLabel : undefined}
    >
      {props.children}
    </div>
  )
}

/** flex:1 filler. This is the `margin-left: auto` killer — that idiom was inline-styled twice. */
Toolbar.Spacer = () => <span class="ui-toolbar-spacer" />

/** A gap-tightened cluster, for pairs that read as one control (a find bar's prev/next). */
Toolbar.Group = (props: { class?: string; children: JSX.Element }) => (
  <span class={cx('ui-toolbar-group', props.class)}>{props.children}</span>
)

/* ── Chip ────────────────────────────────────────────────────────────────────────────────────
   Badge's interactive sibling. Rule of thumb for call sites, because the survey showed this is the
   distinction people kept re-deciding: **static label → Badge; interactive or data-coloured → Chip.**

   `color` takes an arbitrary provider colour (a Linear state, a GitHub label) and drives a dot plus
   a tinted border, which is what `.ln-state` and github's `.integration-row-state` each did with the
   same inline-var trick — two implementations of one visual.

   The element switches on interactivity: `onActivate` renders a <button>, otherwise a <span> whose
   × is its own small button. */
export function Chip(props: {
  tone?: 'neutral' | 'accent' | 'add' | 'del' | 'warn'
  color?: string
  onRemove?: () => void
  onActivate?: () => void
  leading?: JSX.Element
  size?: 'xs' | 'sm'
  dashed?: boolean
  /** Hide the × until the chip is hovered or focused, as github's label rows do. */
  reveal?: boolean
  title?: string
  class?: string
  /** Solid's conditional-class idiom, for call sites carrying a legacy state class (docker's
   *  `.active` selection). */
  classList?: Record<string, boolean | undefined>
  children: JSX.Element
}) {
  const attrs = () => ({
    class: cx('ui-chip', props.class),
    classList: props.classList,
    'data-tone': props.tone ?? 'neutral',
    'data-size': props.size ?? 'sm',
    'data-dashed': props.dashed ? '' : undefined,
    'data-reveal': props.reveal ? '' : undefined,
    'data-colored': props.color ? '' : undefined,
    title: props.title,
    // A provider colour has to reach CSS somehow, and a custom property is the only way to hand a
    // runtime value to a stylesheet. Sanitised, because it comes off an API response: anything but a
    // plain colour token is dropped rather than interpolated into a style attribute.
    style: props.color && SAFE_COLOR.test(props.color) ? { '--chip-color': props.color } : undefined,
  })
  const body = (
    <>
      <Show when={props.leading}><span class="ui-chip-leading">{props.leading}</span></Show>
      <span class="ui-chip-label">{props.children}</span>
    </>
  )
  return (
    <Show
      when={props.onActivate}
      fallback={
        <span {...attrs()}>
          {body}
          <Show when={props.onRemove}>
            <button type="button" class="ui-chip-remove" aria-label="Remove" onClick={() => props.onRemove?.()}>✕</button>
          </Show>
        </span>
      }
    >
      <button type="button" {...attrs()} onClick={() => props.onActivate?.()}>{body}</button>
    </Show>
  )
}

// #rgb/#rrggbb/#rrggbbaa, rgb()/rgba()/hsl()/hsla(), or a bare CSS ident. Enough for every provider
// colour in the codebase and nothing that can close a style attribute.
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/]+\)|[a-zA-Z-]+)$/

/* ── DescriptionList ─────────────────────────────────────────────────────────────────────────
   Label/value pairs: response headers, container info, usage stats, issue facts, fingerprints,
   shortcut tables — the same grid written at least nine times, split between <dl> markup and bare
   div pairs. Two layouts covered all of them: `columns` (label left, value right) and `facts`
   (auto-fit tiles, label above value).

   A real <dl>/<dt>/<dd>, so the pairing is announced — half the hand-rolled sites had no accessible
   pairing at all. Children composition rather than an `items` array, because that is how every
   current site builds them and it keeps the component out of formatting values.

   A site that needs sorting or filtering has outgrown this and wants a table. */
export function DescriptionList(props: {
  layout?: 'columns' | 'facts'
  size?: 'sm' | 'md'
  class?: string
  children: JSX.Element
}) {
  return (
    <dl class={cx('ui-dl', props.class)} data-layout={props.layout ?? 'columns'} data-size={props.size ?? 'md'}>
      {props.children}
    </dl>
  )
}

DescriptionList.Item = (props: { label: JSX.Element; mono?: boolean; class?: string; children: JSX.Element }) => (
  // The wrapping div is what makes grid placement work for the `facts` layout, and is the pattern
  // the linear frame already used. `<dl>` permits it.
  <div class={cx('ui-dl-item', props.class)}>
    <dt class="ui-dl-label">{props.label}</dt>
    <dd class="ui-dl-value" data-mono={props.mono ? '' : undefined}>{props.children}</dd>
  </div>
)

/* ── SegmentedControl / ToggleButton ─────────────────────────────────────────────────────────
   Six hand-rolled segment groups. Two components rather than one because the semantics genuinely
   differ: segments switch a VALUE (radiogroup, arrow keys), a toggle flips one boolean
   (aria-pressed). Neither is Tabs — tabs switch PANELS and get tablist semantics. */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: JSX.Element; title?: string; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  ariaLabel: string
  class?: string
}) {
  const move = (delta: number) => {
    const options = props.options.filter((option) => !option.disabled)
    if (!options.length) return
    const current = options.findIndex((option) => option.value === props.value)
    const next = options[(((current < 0 ? 0 : current) + delta) + options.length) % options.length]
    props.onChange(next.value)
  }
  return (
    <div
      class={cx('ui-segments', props.class)}
      data-size={props.size ?? 'md'}
      role="radiogroup"
      aria-label={props.ariaLabel}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
          : 0
        if (!delta) return
        event.preventDefault()
        move(delta)
      }}
    >
      {/* Buttons, not Row: menus and segments are their own semantics (see Button's note). */}
      {props.options.map((option) => (
        <button
          type="button"
          class="ui-segment"
          role="radio"
          aria-checked={option.value === props.value}
          // Only the selected segment is tab-reachable; arrows move within. Standard radiogroup.
          tabindex={option.value === props.value ? 0 : -1}
          disabled={option.disabled}
          title={option.title}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A Button that stays in. Separate name so call sites are greppable; `data-pressed` is what packs
 *  style, and it must read differently from hover in every one of them.
 *
 *  `onPressedChange`, not `onToggle`: ButtonProps extends ComponentProps<'button'>, which already has
 *  a DOM `onToggle` event — the same silent collision as a prop named `ref`. */
export function ToggleButton(props: ButtonProps & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  const [own, rest] = splitProps(props, ['pressed', 'onPressedChange', 'onClick'])
  return (
    <Button
      {...rest}
      data-pressed={own.pressed ? '' : undefined}
      aria-pressed={own.pressed}
      onClick={() => own.onPressedChange(!own.pressed)}
    />
  )
}

/* ── Card ────────────────────────────────────────────────────────────────────────────────────
   A bordered grouping surface, written ten times. No mandated Header/Body/Footer slots: acorn's
   cards are small and dense, and slots would mostly get in the way.

   Distinct from Row on purpose. Row's own note says a style pack may render list rows AS cards
   (Modern's inset rounded row), so the two share surface tokens but keep separate semantics —
   grouping versus list item. This is where packs win big: Modern's rounded inset cards against
   Terminal's flat squares is one selector per pack instead of ten. */
export function Card(props: {
  interactive?: boolean
  selected?: boolean
  stripe?: 'accent' | 'warn' | 'danger'
  pad?: 'sm' | 'md'
  disabled?: boolean
  onActivate?: () => void
  title?: string
  class?: string
  children: JSX.Element
}) {
  const attrs = () => ({
    class: cx('ui-card', props.class),
    'data-selected': props.selected ? '' : undefined,
    'data-stripe': props.stripe,
    'data-pad': props.pad ?? 'md',
    title: props.title,
  })
  return (
    <Show
      when={props.interactive || props.onActivate}
      fallback={<div {...attrs()}>{props.children}</div>}
    >
      <button type="button" {...attrs()} data-interactive="" disabled={props.disabled} onClick={() => props.onActivate?.()}>
        {props.children}
      </button>
    </Show>
  )
}

/* ── Meter ───────────────────────────────────────────────────────────────────────────────────
   A ratio bar. Div-based rather than a native <meter> so a style pack can actually restyle it —
   docker's two native meters are the argument, being the only controls in the app a pack cannot
   touch at all.

   `label` is required because all three existing bars had no accessible name, so a screen reader
   announced a number with nothing attached to it.

   `auto` implements context's 80/95% thresholds once. If a second site needs different cutoffs it
   can take them as a prop then. */
const METER_WARN = 0.8
const METER_DANGER = 0.95

export function Meter(props: {
  value: number
  tone?: 'accent' | 'warn' | 'danger' | 'auto'
  label: string
  size?: 'sm' | 'md'
  class?: string
}) {
  const ratio = () => Math.min(1, Math.max(0, props.value))
  const tone = () => {
    if (props.tone !== 'auto') return props.tone ?? 'accent'
    return ratio() >= METER_DANGER ? 'danger' : ratio() >= METER_WARN ? 'warn' : 'accent'
  }
  return (
    <div
      class={cx('ui-meter', props.class)}
      data-tone={tone()}
      data-size={props.size ?? 'sm'}
      role="progressbar"
      aria-label={props.label}
      aria-valuenow={Math.round(ratio() * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* The only inline value is a number; CSS turns it into a width, so a pack can change the
          fill's shape without the component knowing. */}
      <span class="ui-meter-fill" style={{ '--meter-value': String(ratio()) }} />
    </div>
  )
}

/* ── CodeBlock ───────────────────────────────────────────────────────────────────────────────
   The mono sunken block, written nine times. Syntax highlighting stays out: callers that highlight
   (Shiki in the agents transcript, the diff toolkit) pass tokenized children.

   A code *textarea* is not this — that is `Textarea mono`, which retires `.settings-script`.

   Logs that stream keep their own scroll-follow logic. This is the box, not the tail. */
export function CodeBlock(props: {
  /** `true` copies the rendered text; a string copies that instead. */
  copy?: boolean | string
  /** Sandboxed frames have no `navigator.clipboard`, so they pass their bridge's copy here. */
  onCopy?: (text: string) => void
  wrap?: boolean
  size?: 'xs' | 'sm'
  maxHeight?: 'none' | 'block'
  class?: string
  children: JSX.Element
}) {
  let codeRef: HTMLElement | undefined
  const copyText = () => (typeof props.copy === 'string' ? props.copy : codeRef?.textContent ?? '')
  return (
    <div class={cx('ui-code-wrap', props.class)} classList={{ copyable: !!props.copy }}>
      <pre
        class="ui-code"
        data-wrap={props.wrap ? '' : undefined}
        data-size={props.size ?? 'sm'}
        data-max={props.maxHeight ?? 'none'}
      ><code ref={(el) => { codeRef = el }}>{props.children}</code></pre>
      <Show when={props.copy}>
        <CopyButtonSlot text={copyText} onCopy={props.onCopy} />
      </Show>
    </div>
  )
}

// Inline rather than importing ui/CopyButton: that component owns a copied-tick signal and reaches
// `navigator.clipboard` directly, which a sandboxed frame cannot do. This is the same affordance with
// the clipboard call injectable, and it keeps primitives.tsx free of a component-to-component import.
function CopyButtonSlot(props: { text: () => string; onCopy?: (text: string) => void }) {
  const [done, setDone] = createSignal(false)
  return (
    <Button
      variant="bare"
      size="sm"
      class="ui-code-copy copy-abs"
      aria-label={done() ? 'Copied' : 'Copy'}
      onClick={() => {
        const text = props.text()
        if (props.onCopy) props.onCopy(text)
        else void navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done() ? '✓' : '⧉'}
    </Button>
  )
}

/* ── Table ───────────────────────────────────────────────────────────────────────────────────
   Deliberately thin: real <table> semantics, token styling, and the horizontal-scroll wrapper both
   existing sites hand-rolled and one of them forgot. No column defs, no sorting, no virtualization
   — when a consumer needs sorting it can grow a `Table.SortHeader`.

   Not for the virtualized grids (.diff-row, .dbgrid-row): those are measured geometry where a
   changed box model silently corrupts scroll math, which is the same reason Row excludes them. */
export function Table(props: {
  size?: 'sm' | 'md'
  stickyHead?: boolean
  /** Sets the h-scroll floor. Without it a wide table forces the whole pane to scroll sideways. */
  minWidth?: number
  class?: string
  children: JSX.Element
}) {
  return (
    <div class="ui-table-scroll" data-scroll={props.minWidth ? '' : undefined}>
      <table
        class={cx('ui-table', props.class)}
        data-size={props.size ?? 'md'}
        data-sticky={props.stickyHead ? '' : undefined}
        style={props.minWidth ? { 'min-width': `${props.minWidth}px` } : undefined}
      >
        {props.children}
      </table>
    </div>
  )
}

/* ── TreeRow ─────────────────────────────────────────────────────────────────────────────────
   A Row with a disclosure twist and a depth. A wrapper rather than more Row props, so Row's API
   stays flat.

   `depth` generalises Row's single `nested` boolean; the twist renders from the marker token rather
   than a glyph literal, and carries `aria-expanded`.

   Tree CONTAINER semantics (role="tree"/"treeitem"/aria-level) stay at the call site: a row cannot
   know its tree. Wire the container yourself — full roving-focus tree navigation is a later layer,
   and the editor's file tree is the candidate that would need it. */
export function TreeRow(props: {
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number
  selected?: boolean
  onActivate?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  /** Trailing metadata — Row's slot, forwarded. A tree row wants a size or a count as much as a
   *  flat one does, and without this a caller has to hand-roll `.ui-row-meta` in the body. */
  meta?: JSX.Element
  /** Hide `trailing` until hover or focus — the idiom five stylesheets implemented separately. */
  reveal?: boolean
  title?: string
  class?: string
  children: JSX.Element
}) {
  return (
    <Row
      selected={props.selected}
      depth={props.depth}
      reveal={props.reveal}
      density="compact"
      title={props.title}
      meta={props.meta}
      class={cx('ui-treerow', props.class)}
      onActivate={props.onActivate}
      leading={
        <>
          <Show
            when={props.expandable}
            // A non-expandable row still reserves the twist's width, or sibling labels misalign.
            fallback={<span class="ui-row-twist" data-empty="" aria-hidden="true" />}
          >
            <span
              class="ui-row-twist"
              role="button"
              tabindex={-1}
              aria-expanded={props.expanded}
              aria-label={props.expanded ? 'Collapse' : 'Expand'}
              onClick={(event) => {
                // The row's own activate must not also fire: expanding is not opening.
                event.stopPropagation()
                props.onToggle?.()
              }}
            />
          </Show>
          {props.leading}
        </>
      }
      trailing={props.trailing}
    >
      {props.children}
    </Row>
  )
}

/* ── SplitHandle ─────────────────────────────────────────────────────────────────────────────
   The drag-resize grip. Behaviour is createSplitDrag (ui/split.ts) — this is the markup, which is a
   wide hit area around a hairline, lifted from `.pane-divider`.

   Three surfaces hand-rolled this and none had keyboard support, so a split was mouse-only. */
export function SplitHandle(props: { axis: 'x' | 'y'; drag: SplitDrag; class?: string }) {
  return <div {...props.drag.handleProps} class={cx('ui-split-handle', props.class)} data-axis={props.axis} />
}

/* ── ListDetail ──────────────────────────────────────────────────────────────────────────────
   List on the left, detail on the right. Four panes each invented one — two grids (rollbar,
   linear), a flex row (database) and a third grid (http) — with four column widths and two
   different border ROLES, which is why they read as slightly-different versions of the same pane
   rather than the same pane. The widths collapse to two genres: a compact switcher rail and a
   browse list.

   NOT for a Source that claims the whole shell — docker's browse is `.panes` + `.pane`, the inset
   card genre with a gap between columns, and that layout belongs to the shell (styles/shell.css).
   The test is whether the two columns are one surface split by a divider or two separate surfaces.

   `list` omitted renders a single full-width column, because rollbar and linear both drop the
   switcher when a task links exactly one item, and a two-column grid holding one child is not that.

   Scrolling is the caller's to declare: `scrollDetail` makes the detail column one scroller (a
   document view), and its absence means the children own their own (a toolbar over a grid). Every
   consumer had this, and nobody had it the same way, but neither answer is wrong. */
export function ListDetail(props: {
  list?: JSX.Element
  /** aria-label for the list column. It is a landmark; name it. */
  listLabel?: string
  /** `narrow` is the compact identifier switcher; `default` is the browse list. */
  listWidth?: 'narrow' | 'default'
  /** Detail column scrolls as one region. Otherwise its children own their scrolling. */
  scrollDetail?: boolean
  /** `main` when this split IS the document — a plugin frame, where nothing else claims the
   *  landmark. A pane inside the shell leaves it a div, because the shell owns the page's `main`. */
  detailAs?: 'div' | 'main'
  class?: string
  listClass?: string
  detailClass?: string
  children: JSX.Element
}) {
  return (
    <div
      class={cx('ui-listdetail', props.class)}
      data-list={props.list === undefined ? undefined : (props.listWidth ?? 'default')}
    >
      {/* <aside> rather than a div: the list is a complementary landmark, and naming it is the only
          way a screen reader can tell two same-shaped columns apart. */}
      <Show when={props.list !== undefined}>
        <aside class={cx('ui-listdetail-list', props.listClass)} aria-label={props.listLabel}>
          {props.list}
        </aside>
      </Show>
      <Dynamic
        component={props.detailAs ?? 'div'}
        class={cx('ui-listdetail-detail', props.detailClass)}
        data-scroll={props.scrollDetail ? '' : undefined}
      >
        {props.children}
      </Dynamic>
    </div>
  )
}
