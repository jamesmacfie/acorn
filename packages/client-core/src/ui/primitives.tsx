import {
  createEffect, createSignal, For, onCleanup, onMount, Show, splitProps,
  type ComponentProps, type JSX,
} from 'solid-js'
import { Dynamic, Portal } from 'solid-js/web'
import { createAnchoredPopover, type AnchoredPopover } from './anchor'
import { createArmedConfirm } from './confirm'
import { nextListIndex } from './focus'
import type { SplitDrag } from './split'
import { cx } from './cx'

/* Button: the action buttons only. Rows, tabs, tree nodes and popover triggers that happen to be
   <button> belong to Row, Tabs, or Picker instead. */
export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'solid' | 'outline' | 'ghost' | 'bare'
  tone?: 'neutral' | 'accent' | 'danger' | 'warn'
  /** `xs` is the chrome-badge size: a glyph affordance inside a topbar strip. */
  size?: 'xs' | 'sm' | 'md'
  iconOnly?: boolean
  busy?: boolean
  /** Renders an <a class="ui-btn">. A control that navigates is a link, not a button: middle-click,
   *  copy-link, and screen-reader semantics depend on it. */
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

type ControlOwn = {
  size?: 'sm' | 'md'
  invalid?: boolean
  width?: 'full' | 'auto' | 'narrow'
  /* `filter` is the boxed list-narrowing input. `bare` is the borderless underline that heads a
     palette or popover. */
  kind?: 'filter' | 'bare'
}

const controlAttrs = (own: ControlOwn & { class?: string }, base = 'ui-input') => ({
  class: cx(base, own.class),
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

/** How many options it takes before the list grows a filter box. A native <select> answers a
 *  keystroke with type-ahead; ours draws its own list, so past this length it needs a real one. A
 *  Linear connection offers up to 250 projects and a repository list is not much shorter. Below it,
 *  a box above four rows is noise. */
const FILTER_FROM = 8

/** The open list. Mounted only while the popover is open, so the row refs, the filter text and the
 *  active index start empty on every open rather than accumulating a copy of the list. */
function SelectList(props: {
  popover: AnchoredPopover
  options: () => HTMLOptionElement[]
  value: () => string | undefined
  ariaLabel?: string
  onPick: (option: HTMLOptionElement) => void
}) {
  let listRef: HTMLDivElement | undefined
  let filterRef: HTMLInputElement | undefined
  const [query, setQuery] = createSignal('')
  const filtered = () => {
    const text = query().trim().toLowerCase()
    if (!text) return props.options()
    return props.options().filter((option) => option.text.toLowerCase().includes(text))
  }
  // Measured against the whole list, not the filtered one: a box that disappeared once you had
  // narrowed the list to seven rows would take the text you typed with it.
  const filterable = () => props.options().length >= FILTER_FROM
  // What Enter takes. The first row a click could reach, which is not always the first match.
  const topMatch = () => filtered().find((option) => !option.disabled)
  // Read the rows back out of the DOM rather than collecting them as they mount: options can arrive
  // while the list is open, and a collected array keeps handing the arrow keys rows that have been
  // detached since.
  const enabled = () => [...listRef?.querySelectorAll<HTMLButtonElement>('.ui-menu-item:not([disabled])') ?? []]
  const [active, setActive] = createSignal(0)
  const focusAt = (index: number) => {
    const list = enabled()
    if (!list.length) return
    setActive(index)
    list[index]?.focus()
  }
  // Opening on the current value is what the native control does, and it is what makes the arrow
  // keys mean "the next one" rather than "the second one". A filtered list skips this: typing is the
  // first thing you want to do there, so the box takes the caret from its own ref and the rows keep
  // the current value marked without holding focus.
  onMount(() => queueMicrotask(() => {
    if (filterable()) return
    const chosen = enabled().findIndex((row) => row.dataset.value === props.value())
    focusAt(chosen < 0 ? 0 : chosen)
  }))

  return (
    <Portal>
      <div
        ref={(el) => {
          listRef = el
          props.popover.setSurface(el)
        }}
        class="ui-popover ui-select-list"
        style={props.popover.surfaceStyle()}
        onKeyDown={(event) => {
          // From the filter box the rows are somewhere to go, not somewhere you already are: Enter
          // takes the top match and ArrowDown steps into the list. Every other key is typing, and
          // must reach the input rather than being read as navigation.
          if (event.target === filterRef) {
            const match = topMatch()
            if (event.key === 'Enter' && match) {
              event.preventDefault()
              props.onPick(match)
            } else if (event.key === 'ArrowDown' && enabled().length) {
              event.preventDefault()
              focusAt(0)
            }
            return
          }
          const list = enabled()
          if (!list.length) return
          const next = nextListIndex(active(), list.length, event.key)
          if (next === active() && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          focusAt(next)
        }}
      >
        <Show when={filterable()}>
          <Input
            ref={(el: HTMLInputElement) => { filterRef = el; queueMicrotask(() => el.focus()) }}
            class="ui-select-filter"
            kind="filter"
            type="text"
            placeholder="Filter…"
            aria-label={props.ariaLabel ? `Filter ${props.ariaLabel}` : 'Filter the list'}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </Show>
        <div class="ui-select-options" role="listbox" aria-label={props.ariaLabel}>
          <For each={filtered()} fallback={<p class="ui-select-nomatch muted">No matches.</p>}>
            {(option) => (
              <button
                type="button"
                class="ui-menu-item"
                role="option"
                data-value={option.value}
                aria-selected={option.value === props.value()}
                disabled={option.disabled}
                onClick={() => props.onPick(option)}
              >
                <span class="ui-menu-label">{option.text}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Portal>
  )
}

/** A select whose list we draw ourselves.
 *
 *  The native <select> stays in the DOM, hidden, as the option list, the value store and the event
 *  source: call sites keep writing <option> children and reading `event.currentTarget.value` in
 *  onChange, and neither has to know the popup changed. Only the popup is ours, because the one the
 *  platform draws ignores every token in the stylesheet. */
export function Select(props: ComponentProps<'select'> & ControlOwn) {
  const [own, trigger, rest] = splitProps(
    props,
    ['size', 'invalid', 'width', 'kind', 'class'],
    ['id', 'title', 'disabled', 'aria-label', 'aria-labelledby'],
  )
  let native: HTMLSelectElement | undefined
  let triggerRef: HTMLButtonElement | undefined

  // The hidden select is read, not modelled, so a signal has to say when to read it again. Options
  // arrive from the caller's <For> long after mount (a repository list, a branch list), and the
  // observer is what notices.
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion((n) => n + 1)
  onMount(() => {
    if (!native) return
    const observer = new MutationObserver(() => bump())
    observer.observe(native, { attributes: true, characterData: true, childList: true, subtree: true })
    onCleanup(() => observer.disconnect())
    bump()
  })
  // Solid writes `value` as a property, which no observer sees.
  createEffect(() => {
    void rest.value
    bump()
  })
  // Options usually arrive after the value does, and a <select> told to hold a value it has no
  // option for quietly falls back to the first one, which left a picker restored from a saved
  // project sitting on the wrong row. Put the caller's value back once its option turns up.
  createEffect(() => {
    version()
    const wanted = rest.value
    if (!native || wanted == null || Array.isArray(wanted)) return
    const want = String(wanted)
    if (native.value === want || ![...native.options].some((option) => option.value === want)) return
    native.value = want
    bump()
  })

  const options = (): HTMLOptionElement[] => {
    version()
    return native ? [...native.options] : []
  }
  const value = () => {
    version()
    return native?.value
  }
  const label = () => {
    version()
    return native?.selectedOptions[0]?.text ?? ''
  }

  const popover = createAnchoredPopover({
    anchor: () => triggerRef,
    minWidth: 'anchor',
    // A select near the bottom of a pane would otherwise open past the bottom of the window. Clamp
    // pulls the list back inside, over the trigger, which is what the platform's own popup does.
    clamp: true,
    disabled: () => !!trigger.disabled,
    onDismiss: () => triggerRef?.focus(),
  })

  const pick = (option: HTMLOptionElement) => {
    popover.close()
    if (!native || option.disabled) return
    native.value = option.value
    // The caller's onChange is bound to the select, so the change has to come from the select.
    native.dispatchEvent(new Event('change', { bubbles: true }))
    bump()
  }

  return (
    <>
      <select {...rest} ref={native} disabled={trigger.disabled} class="ui-select-native" tabindex={-1} aria-hidden="true" />
      <button
        type="button"
        {...trigger}
        ref={triggerRef}
        {...controlAttrs(own, 'ui-input ui-select')}
        aria-haspopup="listbox"
        aria-expanded={popover.open()}
        onClick={() => popover.toggle()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          popover.show()
        }}
      >
        <span class="ui-select-value">{label()}</span>
        <span class="ui-select-chevron" aria-hidden="true">▾</span>
      </button>
      <Show when={popover.open()}>
        <SelectList
          popover={popover}
          options={options}
          value={value}
          ariaLabel={trigger['aria-label'] ?? undefined}
          onPick={pick}
        />
      </Show>
    </>
  )
}

export function Textarea(props: ComponentProps<'textarea'> & ControlOwn & { mono?: boolean }) {
  const [own, rest] = splitProps(props, ['size', 'invalid', 'width', 'kind', 'mono', 'class'])
  return <textarea {...rest} {...controlAttrs(own)} data-mono={own.mono ? '' : undefined} />
}

/** Label + control + optional hint/error.
 *
 *  `group` covers what a `<label>` cannot: several controls under one caption, each with a label of
 *  its own. Nested labels are invalid, and the browser's repair points the outer one at the first
 *  control, so clicking the caption toggles a checkbox nobody meant to touch. `role="group"` with
 *  the caption as its accessible name says the true thing instead. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  /** `stack` is label over control. See docs/ui-design.md for `row` and `split`. */
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

/* Badge. See docs/ui-design.md for `shape`. `dashed` exists for the Database example-picker's
   "add" chip, the one non-solid border in the codebase. */
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

/* Spinner. The rotation stays on the wrapper span rather than the svg, so a pack can swap the mark
   without touching the animation. */
export function Spinner(props: { size?: 'sm' | 'md'; label?: string }) {
  return (
    <span class="ui-spinner spin" data-size={props.size ?? 'sm'} role="status" aria-label={props.label ?? 'Working'}>
      {/* Inline Lucide loader-circle geometry, so Button does not pull in the whole icon registry
          for a busy state. */}
      <svg class="glyph" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </span>
  )
}

/* SectionHeader. `level` is the role, not the size: 'pane' is the sticky pane header, 'group' a
   list grouping, 'sub' an inline subheading. */
export function SectionHeader(props: {
  level?: 'pane' | 'group' | 'sub'
  sticky?: boolean
  count?: number
  actions?: JSX.Element
  class?: string
  children: JSX.Element
}) {
  // Emits the existing `.section-header` class rather than a parallel `.ui-*` one: it is already a
  // single shared rule at 18 sites, so a pack can reach it. What this adds is the count and
  // actions slots.
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

/* Row: navigational list rows, including the role/tabindex/Enter/Space wiring an activatable row
   needs.

   Not for the tabular rows (.diff-row, .dbgrid-row, and similar): those are measured geometry
   where a changed box model silently corrupts scroll math. A virtualized list row is fine; github's
   PR list takes its measured height through `style` and opts out of `min-height`. */
export function Row(props: {
  /** Number of `.ui-row-field` cells inside `meta`, so the row can reserve a track for each. */
  metaFields?: number
  selected?: boolean
  nested?: boolean
  /** Indentation level. Generalises `nested` (which is depth 1) for TreeRow. */
  depth?: number
  /** Hide `trailing` until hover or focus. */
  reveal?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onActivate?: () => void
  /** Renders an <a class="ui-row">.
   *
   *  With `onActivate` it behaves as the router's <A> does: a plain left-click is intercepted and
   *  routed, while middle-click, cmd-click and "copy link address" fall through to the real href.
   *  Reimplemented rather than imported, because primitives.tsx is served to plugin frames, and a
   *  frame is a separate document with no Router above it. */
  href?: string
  /** Absolute placement from a virtualizer. */
  style?: JSX.CSSProperties
  /** Pointer or keyboard focus entered or left the row. One callback rather than four handlers,
   *  because every caller does the same thing with all four: start a prefetch, then cancel it. */
  onHover?: (entered: boolean) => void
  /** `stacked` is the multi-line row, such as rollbar's occurrence list. */
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
      <Show when={props.meta}><span class="ui-row-meta" data-fields={props.metaFields || undefined}>{props.meta}</span></Show>
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
        style={props.style}
        onFocus={() => props.onHover?.(true)}
        onBlur={() => props.onHover?.(false)}
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
        onClick={(event) => {
          if (!props.onActivate) return
          // Leave the browser its own answers: a new tab, a new window, a download, or a handler
          // that already claimed the event.
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          activate()
        }}
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
          // Only when the row itself has focus; a button nested inside owns its own keys.
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

/* Alert. `variant='inline'` is red text with no box; `variant='banner'` is the bordered callout.

   `role` is derived rather than a prop, because three values were in circulation (alert, status,
   none) chosen at random. A danger alert interrupts; everything else is polite. */
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

/* EmptyState. `busy` folds loading in rather than sitting beside a sibling: "loading...", "no
   data", and "unconfigured, do X" are one box with different contents.

   No illustration library and no built-in reasons. The call site supplies the why, this supplies
   the geometry. See docs/ui-design.md § States. */
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

/* StatusDot. Tones are semantic, not domain states: the call site maps running to ok, exited to
   muted, failed to bad. No children; a dot with a label beside it is Row or Badge composition. */
export function StatusDot(props: {
  /* `mixed` (half-bad, half-warn) lives here because two owners render it, core's rail status and
     github's PR rows, so a call-site rule would have to be reached for across that boundary. */
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

/* Checkbox. See docs/ui-design.md § How the primitives are built for why it styles the native
   input rather than rebuilding it, and how `switch` reuses the same element. */
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
  // Tri-state is a DOM property, not an attribute, so it takes an effect.
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

/* ConfirmButton: arm to confirm. The armed button is the prompt, and it never calls
   window.confirm, which a sandboxed frame silently returns false from.

   `skipConfirm` exists for docker's `confirmDestructive` pref gate. Where the armed state must live
   outside one button, such as a group header arming a row key, use createArmedConfirm directly. */
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
        {/* The label is the whole signal that a second click commits, so announce it. */}
        <span aria-live="polite">{own.confirmLabel ?? 'Sure?'}</span>
      </Show>
    </Button>
  )
}

/* Kbd: a key cap. Its height is fixed and the glyph centred, so a cap cannot grow the line-height
   of the row it sits in. */
export function Kbd(props: { size?: 'xs' | 'sm'; class?: string; children: JSX.Element }) {
  return <kbd class={cx('ui-kbd', props.class)} data-size={props.size ?? 'sm'}>{props.children}</kbd>
}

/* Toolbar: the bar strip. `bar` is the bordered pane strip; `actions` is the borderless
   end-aligned form or modal footer. No arrow-key roving, because most of these mix inputs and
   buttons, where roving hurts. Not for tab strips or the topbar, which have their own semantics. */
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

/** flex:1 filler, in place of the `margin-left: auto` idiom. */
Toolbar.Spacer = () => <span class="ui-toolbar-spacer" />

/** A gap-tightened cluster, for pairs that read as one control (a find bar's prev/next). */
Toolbar.Group = (props: { class?: string; children: JSX.Element }) => (
  <span class={cx('ui-toolbar-group', props.class)}>{props.children}</span>
)

/* Chip: Badge's interactive sibling. See docs/ui-design.md § How the primitives are built
   (Badge / Chip) for when to use which, and for `data-colored`.

   The element switches on interactivity: `onActivate` renders a <button>, otherwise a <span> whose
   x is its own small button. */
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
  /** Solid's conditional-class idiom, for a call site carrying its own state class. */
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
    // A custom property is the only way to hand a runtime value to a stylesheet. Sanitised because
    // the colour comes off an API response: anything but a plain colour token is dropped.
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

/* DescriptionList: label/value pairs. `columns` puts the label left and the value right; `facts`
   is auto-fit tiles with the label above the value. A real <dl>/<dt>/<dd> announces the pairing.

   It takes children rather than an `items` array, which keeps it out of formatting values. A site
   that needs sorting or filtering wants a table instead. */
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
  // The wrapping div is what makes grid placement work for the `facts` layout. `<dl>` permits it.
  <div class={cx('ui-dl-item', props.class)}>
    <dt class="ui-dl-label">{props.label}</dt>
    <dd class="ui-dl-value" data-mono={props.mono ? '' : undefined}>{props.children}</dd>
  </div>
)

/* SegmentedControl and ToggleButton stay two components because the semantics differ. Segments
   switch a value (radiogroup, arrow keys); a toggle flips one boolean (aria-pressed). Neither is
   Tabs, which switches panels and gets tablist semantics. */
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

/** A Button that stays in. `data-pressed` is what packs style, and it has to read differently from
 *  hover in every one of them.
 *
 *  `onPressedChange`, not `onToggle`: ButtonProps extends ComponentProps<'button'>, which already
 *  has a DOM `onToggle` event. Same silent collision as a prop named `ref`. */
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

/* Card: a bordered grouping surface. No mandated Header/Body/Footer slots; acorn's cards are small
   and dense, and slots would get in the way.

   Distinct from Row. A style pack may render list rows as cards, so the two share surface tokens
   but keep separate semantics: grouping against list item. */
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

/* Meter: a ratio bar. See docs/ui-design.md § How the primitives are built for why it is a div and
   not a native <meter>.

   `label` is required, or a screen reader announces a number with nothing attached to it. `auto`
   uses context's 80% and 95% thresholds. */
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
      <span class="ui-meter-fill" style={{ '--meter-value': String(ratio()) }} />
    </div>
  )
}

/* CodeBlock: the mono sunken block. Syntax highlighting stays out; callers that highlight pass
   tokenized children. A code textarea is `Textarea mono` instead. Logs that stream keep their own
   scroll-follow logic, because this is the box, not the tail. */
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

// Inline rather than importing ui/CopyButton: that component reaches `navigator.clipboard`
// directly, which a sandboxed frame cannot do. Here the clipboard call is injectable.
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

/* Table: real <table> semantics, token styling, and a horizontal-scroll wrapper. No column defs,
   no sorting, no virtualization; a consumer that needs sorting can grow a `Table.SortHeader`.

   Not for the virtualized grids (.diff-row, .dbgrid-row), which are measured geometry, the same
   reason Row excludes them. */
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

/* TreeRow: a Row with a disclosure twist and a depth, kept a wrapper so Row's API stays flat.

   Tree container semantics (role="tree"/"treeitem"/aria-level) stay at the call site, since a row
   cannot know its tree. Wire the container yourself; there is no roving-focus tree navigation. */
export function TreeRow(props: {
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number
  selected?: boolean
  onActivate?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  /** Trailing metadata: Row's slot, forwarded. */
  meta?: JSX.Element
  /** Hide `trailing` until hover or focus. */
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

/* SplitHandle: the drag-resize grip. Behaviour lives in createSplitDrag (ui/split.ts); this is the
   markup, a wide hit area around a hairline. */
export function SplitHandle(props: { axis: 'x' | 'y'; drag: SplitDrag; class?: string }) {
  return <div {...props.drag.handleProps} class={cx('ui-split-handle', props.class)} data-axis={props.axis} />
}

/* ListDetail: list beside detail. See docs/ui-design.md § Two-column panes for what it replaces,
   the layout rules, and when not to use it. */
export function ListDetail(props: {
  list?: JSX.Element
  /** aria-label for the list column. It is a landmark; name it. */
  listLabel?: string
  /** `narrow` is the compact identifier switcher; `default` is the browse list. */
  listWidth?: 'narrow' | 'default'
  /** Detail column scrolls as one region. Otherwise its children own their scrolling. */
  scrollDetail?: boolean
  /** `main` when this split is the document itself, such as a plugin frame where nothing else
   *  claims the landmark. A pane inside the shell leaves it a div, because the shell owns the
   *  page's `main`. */
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
      {/* <aside> rather than a div: the list is a complementary landmark, and naming it is how a
          screen reader tells two same-shaped columns apart. */}
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
