import { createSignal, For, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover, type AnchoredPopover } from '../../lib/controls/anchor'
import { createDomCollection } from '../../keys/collection'
import { controlAttrs, type ControlOwn } from './controlAttrs'
import { Input } from './Input'

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
  // membership is only knowable at the moment a key arrives (../../keys/collection.ts).
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
export type SelectProps = ControlOwn & {
  options: readonly SelectOption[]
  value?: string
  onChange?: (value: string) => void
}

export function Select(props: SelectProps) {
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
