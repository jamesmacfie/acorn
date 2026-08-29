import {
  createEffect, createSignal, For, onMount, Show, splitProps,
  type JSX,
} from 'solid-js'
import { Dynamic, Portal } from 'solid-js/web'
import { createAnchoredPopover, type AnchoredPopover } from './anchor'
import { createArmedConfirm } from './confirm'
import type { SplitDrag } from './split'
import { createCollection, createDomCollection, type ItemProps } from '../keys/collection'
import type { Size, Tone } from './kit/tokens'

// The kit's nodes. Every prop on this page is the node's own: a role token, a string of content, a
// count, a boolean, or a handler from the kit's event set. None of them is `class`, `style`, or a
// DOM attribute passed through. See docs/ui-design.md § The closed kit for the rule and what it
// buys, and docs/future/layout/04-kit.md for the node set it closes.

/** The delegated tooltip, as props rather than attributes. See docs/ui-design.md § Tooltips: the
 *  contract is still four data attributes on the element, but only the kit writes them now. */
type Tipped = {
  tip?: string
  /** The second line: what happens, where the tip's first line is what it is. */
  tipSub?: string
  /** A chord to show beside it. */
  tipKey?: string
}

const tipAttrs = (own: Tipped) => ({
  'data-tip': own.tip,
  'data-tip-sub': own.tip ? own.tipSub : undefined,
  'data-tip-key': own.tip ? own.tipKey : undefined,
})

// Anything that is not this document is somebody else's site, and a link to one opens away from the
// app with the opener severed. Derived rather than asked for, so no call site can forget the `rel`.
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i
const isExternal = (href: string) => EXTERNAL.test(href) && !href.startsWith('#')

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
  /** The long form of the label, on hover. `tip` is the richer one; this is the browser's. */
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
  title: own.title,
  hidden: own.hidden,
})

export function Button(props: ButtonProps) {
  // The label doubles as the visible text, so a call site that has only words never writes them
  // twice.
  const body = () => (
    <>
      <Show when={props.busy}><Spinner size="sm" /></Show>
      <Show when={props.children} fallback={props.label}>{props.children}</Show>
    </>
  )
  return (
    <Show
      when={props.href}
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

/** What every text control shares. Semantic: how big, how wide, whether it is a filter box or a
 *  bare underline, and whether what it holds is valid. */
type ControlOwn = {
  size?: Extract<Size, 'sm' | 'md'>
  invalid?: boolean
  width?: 'full' | 'auto' | 'narrow'
  /* `filter` is the boxed list-narrowing input. `bare` is the borderless underline that heads a
     palette or popover. */
  kind?: 'filter' | 'bare'
  /** The accessible name, where no <Field> gives it one. */
  label?: string
  title?: string
  id?: string
  name?: string
  disabled?: boolean
  required?: boolean
  autofocus?: boolean
  /** Whether the platform helps with what is typed: spelling, autocorrect, capitalisation. One prop
   *  rather than three attributes, because the answer is always the same for all three. Off for
   *  anything that is not prose: an identifier, a URL, a query. Defaults to on. */
  assist?: boolean
}

const controlAttrs = (own: ControlOwn, base = 'ui-input') => ({
  class: base,
  'data-size': own.size ?? 'md',
  'data-width': own.width ?? 'full',
  'data-kind': own.kind,
  'data-invalid': own.invalid ? '' : undefined,
  'aria-invalid': own.invalid ? ('true' as const) : undefined,
  'aria-label': own.label,
  id: own.id,
  title: own.title,
  disabled: own.disabled,
})

/** The platform's typing help, as the two attributes that carry it. Off `controlAttrs` because a
 *  Select's trigger is a button, and a button has no text to correct. */
const assistAttrs = (own: ControlOwn) => ({
  spellcheck: own.assist,
  autocapitalize: own.assist === false ? ('off' as const) : undefined,
})

/** The text-entry kinds a control may be. No `file`, no `range`, no `color`: each of those is a
 *  different control wearing an input's clothes. */
export type InputType = 'text' | 'search' | 'password' | 'email' | 'url' | 'number' | 'date' | 'time'

export type InputProps = ControlOwn & {
  value?: string | number
  type?: InputType
  placeholder?: string
  readOnly?: boolean
  maxLength?: number
  min?: string | number
  max?: string | number
  step?: string | number
  /** The value as it is typed. An input is host-owned: what comes back is the text, never an event.
   *  Not one of the kit's eleven events, and deliberately: a remote tree cannot bind a per-keystroke
   *  callback, because every keystroke would be a message hop. */
  onInput?: (value: string) => void
  /** The committed value: blur, or Enter. `onChange` rather than `onCommit` because commit IS what
   *  the kit means by a change (docs/future/layout/04-kit.md), and only a name in that list can carry
   *  a handler across the remote root. */
  onChange?: (value: string) => void
  /** Enter, with the value. The kit's own name for "the reader is done and wants this to happen",
   *  which is what a URL bar's Enter means. A caller that also wants keys as they arrive uses
   *  `onKeyDown`, and a remote tree cannot: a DOM event does not cross. */
  onSubmit?: (value: string) => void
  /** An input owns its keys while focused, which is why this is here and nowhere else in the kit.
   *  See docs/ui-design.md § The closed kit. */
  onKeyDown?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Solid's ref, in both spellings: a variable binding or a callback. */
  /** Values to offer while typing. The kit draws the list; a plugin never writes a `<datalist>`.
   *  A list you must pick from is a Select, and one that filters as you type is a Picker. */
  suggestions?: readonly string[]
  ref?: HTMLInputElement | ((element: HTMLInputElement) => void)
}

let suggestionSeq = 0

export function Input(props: InputProps) {
  const [own, rest] = splitProps(
    props,
    ['size', 'invalid', 'width', 'kind', 'label', 'title', 'id', 'name', 'disabled', 'required', 'autofocus', 'assist'],
    ['onInput', 'onChange', 'onSubmit', 'onKeyDown', 'onPaste', 'onFocus', 'onBlur', 'ref'],
  )
  const listId = `ui-suggest-${++suggestionSeq}`
  return (
    <>
    <input
      {...controlAttrs(own)}
      {...assistAttrs(own)}
      ref={rest.ref}
      name={own.name}
      required={own.required}
      autofocus={own.autofocus}
      list={props.suggestions ? listId : undefined}
      type={props.type ?? 'text'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      min={props.min}
      max={props.max}
      step={props.step}
      onInput={(event) => rest.onInput?.(event.currentTarget.value)}
      onChange={(event) => rest.onChange?.(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && rest.onSubmit) rest.onSubmit(event.currentTarget.value)
        rest.onKeyDown?.(event)
      }}
      onPaste={(event) => rest.onPaste?.(event)}
      onFocus={() => rest.onFocus?.()}
      onBlur={() => rest.onBlur?.()}
    />
    <Show when={props.suggestions}>
      {(values) => <datalist id={listId}><For each={values()}>{(value) => <option value={value} />}</For></datalist>}
    </Show>
    </>
  )
}

/** How many options it takes before the list grows a filter box. A native <select> answers a
 *  keystroke with type-ahead; ours draws its own list, so past this length it needs a real one. A
 *  Linear connection offers up to 250 projects and a repository list is not much shorter. Below it,
 *  a box above four rows is noise. */
const FILTER_FROM = 8

/** One row of a Select. A row that needs markup wants a Picker, or a Menu. */
export type SelectOption = {
  value: string
  label: string
  /** The long form, on hover. Agents' model list uses it for the model's description. */
  title?: string
  disabled?: boolean
}

/** The open list. Mounted only while the popover is open, so the row refs, the filter text and the
 *  active index start empty on every open rather than accumulating a copy of the list. */
function SelectList(props: {
  popover: AnchoredPopover
  options: () => readonly SelectOption[]
  value: () => string | undefined
  ariaLabel?: string
  onPick: (option: SelectOption) => void
}) {
  let listRef: HTMLDivElement | undefined
  let filterRef: HTMLInputElement | undefined
  const [query, setQuery] = createSignal('')
  const filtered = () => {
    const text = query().trim().toLowerCase()
    if (!text) return props.options()
    return props.options().filter((option) => option.label.toLowerCase().includes(text))
  }
  // Measured against the whole list, not the filtered one: a box that disappeared once you had
  // narrowed the list to seven rows would take the text you typed with it.
  const filterable = () => props.options().length >= FILTER_FROM
  // What Enter takes. The first row a click could reach, which is not always the first match.
  const topMatch = () => filtered().find((option) => !option.disabled)
  // Read the rows back out of the DOM rather than collecting them as they mount: options can arrive
  // while the list is open, and a collected array keeps handing the arrow keys rows that have been
  // detached since. That is also why this is a DOM collection: the rows are the kit's, but their
  // membership is only knowable at the moment a key arrives (../keys/collection.ts).
  const enabled = () => [...listRef?.querySelectorAll<HTMLButtonElement>('.ui-menu-item:not([disabled])') ?? []]
  const collection = createDomCollection({ selector: '.ui-menu-item' })
  // Opening on the current value is what the native control does, and it is what makes the arrow
  // keys mean "the next one" rather than "the second one". A filtered list skips this: typing is the
  // first thing you want to do there, so the box takes the caret from its own ref and the rows keep
  // the current value marked without holding focus.
  onMount(() => queueMicrotask(() => {
    if (filterable()) return
    const rows = enabled()
    const chosen = rows.findIndex((row) => row.dataset.value === props.value())
    rows[chosen < 0 ? 0 : chosen]?.focus()
  }))

  return (
    <Portal>
      <div
        ref={(el) => {
          listRef = el
          props.popover.setSurface(el)
          collection.attach(el)
        }}
        class="ui-popover ui-select-list"
        style={props.popover.surfaceStyle()}
        onKeyDown={(event) => {
          // From the filter box the rows are somewhere to go, not somewhere you already are: Enter
          // takes the top match and ArrowDown steps into the list. Every other key is typing, and
          // must reach the input rather than being read as navigation. The list's own arrows are the
          // `next` and `prev` intents, so they are not here.
          if (event.target !== filterRef) return
          const match = topMatch()
          if (event.key === 'Enter' && match) {
            event.preventDefault()
            props.onPick(match)
          } else if (event.key === 'ArrowDown' && enabled().length) {
            event.preventDefault()
            enabled()[0]?.focus()
          }
        }}
      >
        <Show when={filterable()}>
          <Input
            ref={(el) => { filterRef = el; queueMicrotask(() => el.focus()) }}
            kind="filter"
            placeholder="Filter…"
            label={props.ariaLabel ? `Filter ${props.ariaLabel}` : 'Filter the list'}
            value={query()}
            onInput={setQuery}
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
                title={option.title}
                onClick={() => props.onPick(option)}
              >
                <span class="ui-menu-label">{option.label}</span>
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
 *  The native <select> stays in the DOM, hidden, as the value store and the form participant: a
 *  Select inside a form still submits, and the platform still owns the value. Only the popup is
 *  ours, because the one the platform draws ignores every token in the stylesheet.
 *
 *  Options are data rather than `<option>` children. A plugin writing raw tags into a control is
 *  exactly what the closed kit is for. */
export function Select(props: ControlOwn & {
  options: readonly SelectOption[]
  value?: string
  onChange?: (value: string) => void
}) {
  let triggerRef: HTMLButtonElement | undefined
  const current = () => props.options.find((option) => option.value === props.value)
  const label = () => current()?.label ?? ''

  const popover = createAnchoredPopover({
    anchor: () => triggerRef,
    minWidth: 'anchor',
    // A select near the bottom of a pane would otherwise open past the bottom of the window. Clamp
    // pulls the list back inside, over the trigger, which is what the platform's own popup does.
    clamp: true,
    disabled: () => !!props.disabled,
    onDismiss: () => triggerRef?.focus(),
  })

  const pick = (option: SelectOption) => {
    popover.close()
    if (option.disabled) return
    props.onChange?.(option.value)
  }

  return (
    <>
      {/* Hidden, and not reachable: the trigger beside it is what a person operates. It is here so a
          form still sees a control with a name and a value. */}
      <select
        class="ui-select-native"
        tabindex={-1}
        aria-hidden="true"
        name={props.name}
        disabled={props.disabled}
        value={props.value ?? ''}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
      >
        <For each={props.options}>
          {(option) => <option value={option.value} disabled={option.disabled}>{option.label}</option>}
        </For>
      </select>
      <button
        {...controlAttrs(props, 'ui-input ui-select')}
        type="button"
        ref={triggerRef}
        autofocus={props.autofocus}
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
          options={() => props.options}
          value={() => props.value}
          ariaLabel={props.label}
          onPick={pick}
        />
      </Show>
    </>
  )
}

export type TextareaProps = ControlOwn & {
  value?: string
  placeholder?: string
  /** Visible lines. A number, because a textarea's height is measured in its own text. */
  rows?: number
  /** Fill the region it is in rather than sizing to `rows`. The note editor and any other "this pane
   *  IS a text field" surface. A role rather than a height: the region's own box decides how tall
   *  that is, and the reader loses the drag handle, which would fight it. */
  grow?: boolean
  mono?: boolean
  readOnly?: boolean
  maxLength?: number
  onInput?: (value: string) => void
  /** The committed value: blur, or Enter. See `InputProps.onChange`. */
  onChange?: (value: string) => void
  /** A textarea owns its keys and its own surface while focused: the composer completes mentions,
   *  the editor takes a dropped file. One of the three nodes the kit lets keys through. See
   *  docs/ui-design.md § The closed kit. */
  onKeyDown?: (event: KeyboardEvent) => void
  onKeyUp?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
  onDrop?: (event: DragEvent) => void
  onDragOver?: (event: DragEvent) => void
  onScroll?: () => void
  onFocus?: () => void
  onBlur?: () => void
  onPress?: () => void
  ref?: HTMLTextAreaElement | ((element: HTMLTextAreaElement) => void)
}

export function Textarea(props: TextareaProps) {
  const [own] = splitProps(
    props,
    ['size', 'invalid', 'width', 'kind', 'label', 'title', 'id', 'name', 'disabled', 'required', 'autofocus', 'assist'],
  )
  return (
    <textarea
      {...controlAttrs(own)}
      {...assistAttrs(own)}
      ref={props.ref}
      name={own.name}
      required={own.required}
      autofocus={own.autofocus}
      data-mono={props.mono ? '' : undefined}
      data-grow={props.grow ? '' : undefined}
      rows={props.rows}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
      onChange={(event) => props.onChange?.(event.currentTarget.value)}
      onKeyDown={(event) => props.onKeyDown?.(event)}
      onKeyUp={(event) => props.onKeyUp?.(event)}
      onPaste={(event) => props.onPaste?.(event)}
      onDrop={(event) => props.onDrop?.(event)}
      onDragOver={(event) => props.onDragOver?.(event)}
      onScroll={() => props.onScroll?.()}
      onFocus={() => props.onFocus?.()}
      onBlur={() => props.onBlur?.()}
      onClick={() => props.onPress?.()}
    />
  )
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
        <label class="ui-field" data-layout={props.layout ?? 'stack'}>{inner}</label>
      )}
    >
      <div class="ui-field" data-layout={props.layout ?? 'stack'} role="group" aria-label={props.label}>
        {inner}
      </div>
    </Show>
  )
}

/* Badge. See docs/ui-design.md for `shape`. `dashed` exists for the Database example-picker's
   "add" chip, the one non-solid border in the codebase. */
export function Badge(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  shape?: 'tag' | 'pill'
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  children: JSX.Element
}) {
  return (
    <span
      class="ui-badge"
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
  children: JSX.Element
}) {
  // Emits the existing `.section-header` class rather than a parallel `.ui-*` one: it is already a
  // single shared rule at 18 sites, so a pack can reach it. What this adds is the count and
  // actions slots.
  return (
    <div
      class="section-header"
      data-level={props.level ?? 'pane'}
      data-sticky={props.sticky ? '' : undefined}
    >
      <span class="ui-section-header-label">{props.children}</span>
      <Show when={props.count != null}><span class="ui-section-header-count">{props.count}</span></Show>
      <Show when={props.actions}><span class="ui-section-header-actions">{props.actions}</span></Show>
    </div>
  )
}

/** Did this click land on a control inside the row rather than on the row itself? A row action's
 *  menu button must not also open the row, and no kit node hands a plugin an event to stop, so the
 *  row works it out. */
const fromNestedControl = (event: MouseEvent): boolean => {
  const target = event.target
  if (!(target instanceof Element)) return false
  const control = target.closest('button, a, input, select, textarea, [role="button"]')
  return control !== null && control !== event.currentTarget
}

/** A virtualizer's absolute placement, as a style. The one place a kit node turns a number into a
 *  pixel, because a virtualizer's geometry has nowhere else to live. */
const placement = (own: { offset?: number; height?: number }): JSX.CSSProperties | undefined =>
  own.offset === undefined && own.height === undefined
    ? undefined
    : {
      ...(own.offset === undefined ? {} : { position: 'absolute' as const, top: '0', left: '0', right: '0', transform: `translateY(${own.offset}px)` }),
      ...(own.height === undefined ? {} : { height: `${own.height}px` }),
    }

/* Row: navigational list rows, including the role/tabindex/Enter/Space wiring an activatable row
   needs.

   Not for the tabular rows (.diff-row, .dbgrid-row, and similar): those are measured geometry
   where a changed box model silently corrupts scroll math. A virtualized list row is fine; github's
   PR list takes its measured height through `style` and opts out of `min-height`. */
export function Row(props: {
  /** The collection's props for this row, from `Rows`. Opaque: the row spreads it and never reads
   *  it. Without it a row is a lone stop, which is what a row outside a `Rows` still is. */
  item?: ItemProps
  /** Number of `.ui-row-field` cells inside `meta`, so the row can reserve a track for each. */
  metaFields?: number
  selected?: boolean
  nested?: boolean
  /** Indentation level. Generalises `nested` (which is depth 1) for TreeRow. */
  depth?: number
  /** Hide `trailing` until hover or focus. */
  reveal?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onPress?: () => void
  /** Renders an <a class="ui-row">.
   *
   *  With `onPress` it behaves as the router's <A> does: a plain left-click is intercepted and
   *  routed, while middle-click, cmd-click and "copy link address" fall through to the real href.
   *  Reimplemented rather than imported, because primitives.tsx is served to plugin frames, and a
   *  frame is a separate document with no Router above it. */
  href?: string
  /** Absolute placement from a virtualizer, in pixels. A measurement, not a design decision: a
   *  virtualizer computes both and no stylesheet can. See docs/ui-design.md § The closed kit. */
  offset?: number
  height?: number
  /** The accessible name, where the row's own text is not one. */
  label?: string
  /** Pointer or keyboard focus entered or left the row. One callback rather than four handlers,
   *  because every caller does the same thing with all four: start a prefetch, then cancel it. */
  onHover?: (entered: boolean) => void
  /** `stacked` is the multi-line row, such as rollbar's occurrence list. `tree` is what TreeRow
   *  renders; it is here rather than as a class so the kit still owns the markup. */
  variant?: 'default' | 'stacked' | 'tree'
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  title?: string
  children: JSX.Element
}) {
  const activate = () => props.onPress?.()
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
        {...(props.item ?? {})}
        href={props.href}
        class="ui-row"
        data-selected={props.selected ? '' : undefined}
        data-depth={props.depth ? String(props.depth) : undefined}
        data-reveal={props.reveal ? '' : undefined}
        data-density={props.density ?? 'default'}
        data-variant={props.variant ?? 'default'}
        title={props.title}
        aria-label={props.label}
        aria-selected={props.item ? !!props.selected : undefined}
        style={placement(props)}
        onFocus={() => { props.item?.onFocus(); props.onHover?.(true) }}
        onBlur={() => props.onHover?.(false)}
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
        onClick={(event) => {
          // A control inside the row keeps its click, and the link must not follow its href either.
          if (fromNestedControl(event)) return event.preventDefault()
          if (!props.onPress) return
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
  // Inside a `Rows` the collection owns the role and the roving tabindex; on its own the row is a
  // lone button-shaped stop, which is what every list was before the kit had a collection node.
  return (
    <div
      {...(props.item ?? {})}
      class="ui-row"
      data-selected={props.selected ? '' : undefined}
      data-nested={props.nested ? '' : undefined}
      data-depth={props.depth ? String(props.depth) : undefined}
      data-reveal={props.reveal ? '' : undefined}
      data-density={props.density ?? 'default'}
      data-variant={props.variant ?? 'default'}
      title={props.title}
      aria-label={props.label}
      aria-selected={props.item ? !!props.selected : undefined}
      style={placement(props)}
      role={props.item?.role ?? (props.onPress ? 'button' : undefined)}
      tabindex={props.item ? props.item.tabindex : props.onPress ? 0 : undefined}
      onClick={props.onPress ? (event) => { if (!fromNestedControl(event)) activate() } : undefined}
      onKeyDown={props.onPress && !props.item
        ? (event) => {
          // Only when the row itself has focus; a button nested inside owns its own keys. Inside a
          // collection this is the `activate` intent instead, so the row does not answer twice.
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
        <Button variant="bare" size="sm" iconOnly label="Dismiss" onPress={() => props.onDismiss?.()}>✕</Button>
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
  children?: JSX.Element
}) {
  return (
    <div
      class="ui-empty"
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
  tone: Extract<Tone, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'>
  /* Half this tone and half warn. A prop rather than a seventh tone, because it is two states at
     once rather than one more state: core's rail status and github's PR rows both draw it. */
  mixed?: boolean
  pulse?: boolean
  label?: string
  size?: Extract<Size, 'sm' | 'md'>
}) {
  return (
    <span
      class="ui-dot"
      data-tone={props.tone}
      data-mixed={props.mixed ? '' : undefined}
      data-size={props.size ?? 'sm'}
      data-pulse={props.pulse ? '' : undefined}
      role={props.label ? 'status' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    />
  )
}

/* Checkbox. See docs/ui-design.md § How the kit is built for why it styles the native
   input rather than rebuilding it, and how `switch` reuses the same element. */
export function Checkbox(props: {
  label?: JSX.Element
  hint?: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  switch?: boolean
  size?: Extract<Size, 'sm' | 'md'>
  nested?: boolean
  /** The accessible name, where there is no visible label. */
  ariaLabel?: string
  title?: string
  id?: string
  name?: string
  onChange?: (checked: boolean) => void
}) {
  let ref: HTMLInputElement | undefined
  // Tri-state is a DOM property, not an attribute, so it takes an effect.
  createEffect(() => {
    if (ref) ref.indeterminate = !!props.indeterminate
  })
  const input = (
    <input
      ref={(el) => { ref = el }}
      type="checkbox"
      class="ui-check-box"
      id={props.id}
      name={props.name}
      checked={props.checked}
      disabled={props.disabled}
      title={props.label ? undefined : props.title}
      aria-label={props.ariaLabel}
      role={props.switch ? 'switch' : undefined}
      onChange={(event) => props.onChange?.(event.currentTarget.checked)}
    />
  )
  return (
    <Show when={props.label} fallback={input}>
      <label
        class="ui-check"
        data-size={props.size ?? 'md'}
        data-switch={props.switch ? '' : undefined}
        data-nested={props.nested ? '' : undefined}
        title={props.title}
      >
        {input}
        <span class="ui-check-label">
          {props.label}
          <Show when={props.hint}><small class="ui-check-hint">{props.hint}</small></Show>
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
  const [own, rest] = splitProps(props, ['confirmLabel', 'timeoutMs', 'skipConfirm', 'onConfirm', 'children', 'tone'])
  const armed = createArmedConfirm(() => own.timeoutMs ?? 3000)
  // The disarm handlers ride a wrapper rather than the Button, because `blur` and `keydown` are DOM
  // events and no kit node takes one. Both bubble to here (`focusout` is the bubbling form of blur).
  return (
    <span
      class="ui-confirm"
      onFocusOut={() => armed.disarm()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !armed.armed()) return
        event.preventDefault()
        armed.disarm()
      }}
    >
      <Button
        {...rest}
        tone={armed.armed() ? 'danger' : own.tone}
        armed={!!armed.armed()}
        onPress={() => {
          if (own.skipConfirm || armed.request('self')) own.onConfirm()
        }}
      >
        <Show when={armed.armed()} fallback={own.children}>
          {/* The label is the whole signal that a second click commits, so announce it. */}
          <span aria-live="polite">{own.confirmLabel ?? 'Sure?'}</span>
        </Show>
      </Button>
    </span>
  )
}

/* Kbd: a key cap. Its height is fixed and the glyph centred, so a cap cannot grow the line-height
   of the row it sits in. */
export function Kbd(props: { size?: Extract<Size, 'xs' | 'sm'>; children: JSX.Element }) {
  return <kbd class="ui-kbd" data-size={props.size ?? 'sm'}>{props.children}</kbd>
}

/* Toolbar: the bar strip. `bar` is the bordered pane strip; `actions` is the borderless
   end-aligned form or modal footer. No arrow-key roving, because most of these mix inputs and
   buttons, where roving hurts. Not for tab strips or the topbar, which have their own semantics. */
export function Toolbar(props: {
  variant?: 'bar' | 'actions'
  size?: 'sm' | 'md'
  ariaLabel?: string
  children: JSX.Element
}) {
  const variant = () => props.variant ?? 'bar'
  return (
    <div
      class="ui-toolbar"
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
/** The gap that pushes what follows to the far end of the bar. A name of its own as well as
 *  `Toolbar.Spacer`, because a remote tree names one type per node and has nowhere to put the dot. */
export const ToolbarSpacer = () => <span class="ui-toolbar-spacer" />

Toolbar.Spacer = ToolbarSpacer

/** A gap-tightened cluster, for pairs that read as one control (a find bar's prev/next). */
Toolbar.Group = (props: { children: JSX.Element }) => (
  <span class="ui-toolbar-group">{props.children}</span>
)

/* Chip: Badge's interactive sibling. See docs/ui-design.md § How the kit is built
   (Badge / Chip) for when to use which, and for `data-colored`.

   The element switches on interactivity: `onPress` renders a <button>, otherwise a <span> whose
   x is its own small button. */
export function Chip(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  /** A provider's own colour, from an API response — a Linear label, a GitHub label. Third-party
   *  identity rather than a design decision, which is why it is the one colour a node accepts. */
  color?: string
  onRemove?: () => void
  onPress?: () => void
  leading?: JSX.Element
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  /** Hide the × until the chip is hovered or focused, as github's label rows do. */
  reveal?: boolean
  /** Picked out of a set, the way a filter chip is. Selection is a state, not a class. */
  selected?: boolean
  title?: string
  children: JSX.Element
}) {
  const attrs = () => ({
    class: 'ui-chip',
    'data-tone': props.tone ?? 'neutral',
    'data-selected': props.selected ? '' : undefined,
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
      when={props.onPress}
      fallback={
        <span {...attrs()}>
          {body}
          <Show when={props.onRemove}>
            <button type="button" class="ui-chip-remove" aria-label="Remove" onClick={() => props.onRemove?.()}>✕</button>
          </Show>
        </span>
      }
    >
      <button type="button" {...attrs()} onClick={() => props.onPress?.()}>{body}</button>
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
  children: JSX.Element
}) {
  return (
    <dl class="ui-dl" data-layout={props.layout ?? 'columns'} data-size={props.size ?? 'md'}>
      {props.children}
    </dl>
  )
}

DescriptionList.Item = (props: { label: JSX.Element; mono?: boolean; children: JSX.Element }) => (
  // The wrapping div is what makes grid placement work for the `facts` layout. `<dl>` permits it.
  <div class="ui-dl-item">
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
}) {
  const collection = createCollection({
    id: () => `segments:${props.ariaLabel}`,
    items: () => props.options.map((option) => ({ key: option.value, disabled: option.disabled })),
    role: 'radiogroup',
    orientation: 'horizontal',
    selectOnMove: true,
    selected: () => props.value,
    onSelect: (value) => props.onChange(value as T),
  })
  return (
    <div class="ui-segments" data-size={props.size ?? 'md'} aria-label={props.ariaLabel} {...collection.containerProps}>
      {/* Buttons, not Row: menus and segments are their own semantics (see Button's note). */}
      {props.options.map((option) => (
        <button
          {...collection.itemProps(option.value)}
          type="button"
          class="ui-segment"
          aria-checked={option.value === props.value}
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
 *  `onPressedChange`, not `onToggle`: a props member named `onToggle` collided with the DOM event of
 *  that name while ButtonProps still spread `ComponentProps<'button'>`, and the name stays for the
 *  same reason a prop is never called `ref`. */
export function ToggleButton(props: ButtonProps & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  const [own, rest] = splitProps(props, ['onPressedChange', 'onPress'])
  return <Button {...rest} onPress={() => own.onPressedChange(!props.pressed)} />
}

/* Card: a bordered grouping surface. No mandated Header/Body/Footer slots; acorn's cards are small
   and dense, and slots would get in the way.

   Distinct from Row. A style pack may render list rows as cards, so the two share surface tokens
   but keep separate semantics: grouping against list item. */
export function Card(props: {
  interactive?: boolean
  selected?: boolean
  stripe?: Extract<Tone, 'accent' | 'warn' | 'danger'>
  pad?: Extract<Size, 'sm' | 'md'>
  disabled?: boolean
  onPress?: () => void
  title?: string
  /** Put the reader on this card: scroll it into view and give it focus.
   *
   *  The kit's, not the caller's, for the reason collection state is: a pane that has been told
   *  "show this item" holds a key and nothing else, and the kit gives it no class and no id to
   *  select on. Setting this is how a pane says which card it means. */
  focus?: boolean
  children: JSX.Element
}) {
  let element: HTMLElement | undefined
  const attrs = () => ({
    class: 'ui-card',
    'data-selected': props.selected ? '' : undefined,
    'data-stripe': props.stripe,
    'data-pad': props.pad ?? 'md',
    title: props.title,
  })
  createEffect(() => {
    if (!props.focus || !element) return
    element.scrollIntoView({ block: 'nearest' })
    element.focus({ preventScroll: true })
  })
  return (
    <Show
      when={props.interactive || props.onPress}
      fallback={(
        // `tabindex` only on the plain card: an interactive one is already a stop, and taking it out
        // of the tab order to make it focusable by script would be the opposite of the ask.
        <div ref={(el) => { element = el }} {...attrs()} tabindex={props.focus === undefined ? undefined : -1}>
          {props.children}
        </div>
      )}
    >
      <button
        ref={(el) => { element = el }}
        type="button"
        {...attrs()}
        data-interactive=""
        disabled={props.disabled}
        onClick={() => props.onPress?.()}
      >
        {props.children}
      </button>
    </Show>
  )
}

/* Meter: a ratio bar. See docs/ui-design.md § How the kit is built for why it is a div and
   not a native <meter>.

   `label` is required, or a screen reader announces a number with nothing attached to it. `auto`
   uses context's 80% and 95% thresholds. */
const METER_WARN = 0.8
const METER_DANGER = 0.95

export function Meter(props: {
  value: number
  tone?: Extract<Tone, 'accent' | 'warn' | 'danger'> | 'auto'
  label: string
  size?: Extract<Size, 'sm' | 'md'>
}) {
  const ratio = () => Math.min(1, Math.max(0, props.value))
  const tone = () => {
    if (props.tone !== 'auto') return props.tone ?? 'accent'
    return ratio() >= METER_DANGER ? 'danger' : ratio() >= METER_WARN ? 'warn' : 'accent'
  }
  return (
    <div
      class="ui-meter"
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
  children: JSX.Element
}) {
  let codeRef: HTMLElement | undefined
  const copyText = () => (typeof props.copy === 'string' ? props.copy : codeRef?.textContent ?? '')
  return (
    <div class="ui-code-wrap">
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
      label={done() ? 'Copied' : 'Copy'}
      onPress={() => {
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
  children: JSX.Element
}) {
  return (
    <div class="ui-table-scroll" data-scroll={props.minWidth ? '' : undefined}>
      <table
        class="ui-table"
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

   Tree container semantics come from `Rows tree`, which is the container: it gives each row its
   `treeitem` role and its place in the roving focus, and turns the left and right arrows into the
   `collapse` and `expand` intents. A `TreeRow` outside one is a lone stop with a twist. */
export function TreeRow(props: {
  /** The collection's props for this row, from `Rows tree`. Forwarded to `Row`. */
  item?: ItemProps
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number
  selected?: boolean
  onPress?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  /** Trailing metadata: Row's slot, forwarded. */
  meta?: JSX.Element
  /** Hide `trailing` until hover or focus. */
  reveal?: boolean
  title?: string
  children: JSX.Element
}) {
  return (
    <Row
      item={props.item}
      selected={props.selected}
      depth={props.depth}
      reveal={props.reveal}
      density="compact"
      variant="tree"
      title={props.title}
      meta={props.meta}
      onPress={props.onPress}
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
export function SplitHandle(props: { axis: 'x' | 'y'; drag: SplitDrag }) {
  return <div {...props.drag.handleProps} class="ui-split-handle" data-axis={props.axis} />
}

/* ListDetail: list beside detail. See docs/ui-design.md § Two-column panes for what it replaces,
   the layout rules, and when not to use it. */
export function ListDetail(props: {
  list?: JSX.Element
  /** Two columns given as `ListColumn` and `DetailColumn` children instead of through `list`. */
  split?: boolean
  /** aria-label for the list column. It is a landmark; name it. */
  listLabel?: string
  /** `narrow` is the compact identifier switcher, `default` is the browse list, and `wide` is a
   *  column that holds a document rather than a picker. */
  listWidth?: 'narrow' | 'default' | 'wide'
  /** Detail column scrolls as one region. Otherwise its children own their scrolling. */
  scrollDetail?: boolean
  /** `main` when this split is the document itself, such as a plugin frame where nothing else
   *  claims the landmark. A pane inside the shell leaves it a div, because the shell owns the
   *  page's `main`. */
  detailAs?: 'div' | 'main'
  children: JSX.Element
}) {
  return (
    <div
      class="ui-listdetail"
      data-list={props.list !== undefined || props.split ? (props.listWidth ?? 'default') : undefined}
    >
      <Show when={props.list !== undefined} fallback={props.children}>
        <>
          {/* <aside> rather than a div: the list is a complementary landmark, and naming it is how a
              screen reader tells two same-shaped columns apart. */}
          <aside class="ui-listdetail-list" aria-label={props.listLabel}>
            {props.list}
          </aside>
          <Dynamic
            component={props.detailAs ?? 'div'}
            class="ui-listdetail-detail"
            data-scroll={props.scrollDetail ? '' : undefined}
          >
            {props.children}
          </Dynamic>
        </>
      </Show>
    </div>
  )
}

/* The two columns as nodes of their own, for a caller that cannot put an element in a prop.
   A remote tree is exactly that caller: its props are JSON on a message port, so `list` above is
   unreachable from a sandbox and the split has to be expressible as children
   (docs/future/layout/06-remote-tree.md § The wire format).

   `split` on ListDetail is what turns the grid on in that form, because the parent can no longer tell
   from `list` whether there are two columns.

   At 80×24: as ListDetail. */
export function ListColumn(props: {
  label?: string
  /** This column is a document rather than a list: it scrolls as one region and takes the pane's
   *  inline padding. A column of rows leaves it unset — its rows own their scrolling and sit flush
   *  against the divider, which is what every list in the app does. */
  scroll?: boolean
  children: JSX.Element
}) {
  return (
    <aside class="ui-listdetail-list" data-scroll={props.scroll ? '' : undefined} aria-label={props.label}>
      {props.children}
    </aside>
  )
}

export function DetailColumn(props: { scroll?: boolean; children: JSX.Element }) {
  return <div class="ui-listdetail-detail" data-scroll={props.scroll ? '' : undefined}>{props.children}</div>
}
