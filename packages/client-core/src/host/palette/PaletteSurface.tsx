import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js'
import { Input } from '../../kit/components/primitives'
import type { PaletteView } from './overlay'
// The component owns its stylesheet, so a consumer can't depend on some other palette having been
// mounted first to get the chrome styled.
import './palette.css'

// The palette markup, deduped. Four surfaces rendered the same backdrop, dialog, input, list and empty
// structure, wiring the same seven handlers from createOverlayPalette by hand, and github's file finder
// had its own `.finder-*` class vocabulary for the same thing.
//
// Beside the hook rather than in ui/, because it imports the view's type and the ui/ purity rule
// carves out `palette/model.ts` only. Behaviour stays behind the view; this is the chrome.
//
// Each caller keeps its own row body: the palettes render label and hint, while the file finders render
// dir and name. A shared row shape would grow a slot per caller, which is the markup it's replacing.
//
// Deliberately not absorbing Picker (anchored, filtered, non-modal) or Modal. The three-way distinction
// is argued in Modal.tsx and dismissable.ts.

/** One instance's id prefix, so `aria-activedescendant` on the input can name a row in the list. Two
 *  palettes mounted at once must not both call their third row `palette-row-2`. */
let surfaceSeq = 0

export function PaletteSurface<T>(props: {
  palette: PaletteView
  items: readonly T[]
  placeholder: string
  emptyText: string
  /** The row's contents. `selected` is the keyboard cursor, not a persistent selection. */
  row: (item: T, selected: boolean) => JSX.Element
  /** Per-row state classes, such as the command palette marking a source's error row. */
  rowClassList?: (item: T) => Record<string, boolean | undefined>
  onPick: (item: T, index: number) => void
  /** A hints line under the list ("↑↓ navigate · ↵ open"). */
  footer?: JSX.Element
  /** Extra content between the input and the list, an error banner. */
  status?: JSX.Element
  /** Where in the command tree this frame is, drawn above the field. The command palette's; a file
   *  finder has no hierarchy and passes nothing (./paletteView.ts). */
  breadcrumb?: readonly string[]
  /** Something is being fetched or invoked. Becomes `aria-busy` on the dialog. */
  busy?: boolean
  /** One line for a screen reader, announced when it changes: how many results, or what failed. */
  announce?: string
  /** An IME is building a character, or has just finished one. The command palette forwards it to the
   *  session, which does not schedule a search until the composition ends. */
  onComposing?: (composing: boolean) => void
  class?: string
  ariaLabel?: string
}) {
  const base = `palette-${++surfaceSeq}`
  const listId = `${base}-list`
  const rowId = (index: number) => `${base}-row-${index}`

  // The three combobox attributes, written onto the element rather than passed to `Input`.
  //
  // `aria-activedescendant` has to sit on the element that holds focus, which is the field, and the
  // kit's Input takes a fixed set of props on purpose (docs/ui-design.md § The closed kit). Adding
  // three ARIA props to a node every pane in the app draws, for one surface, is the wrong trade; the
  // surface owns its own dialog and list markup already, so it owns these too.
  //
  // A signal and not a `let`, because the effect and the `Show` below both wake on `open()` and
  // nothing says which goes first: with a plain variable the effect can run before the field it is
  // meant to describe exists, and the attributes never land.
  const [input, setInput] = createSignal<HTMLInputElement>()
  createEffect(() => {
    const field = input()
    if (!field || !props.palette.open()) return
    field.setAttribute('role', 'combobox')
    field.setAttribute('aria-expanded', 'true')
    field.setAttribute('aria-controls', listId)
    field.setAttribute('aria-autocomplete', 'list')
    // `sel()` is -1 when nothing in the list is selectable, which is what a search frame showing only
    // its loading line or its error is. Naming `row--1` would point a screen reader at an element that
    // does not exist.
    const active = props.palette.sel() >= 0 && props.palette.sel() < props.items.length ? rowId(props.palette.sel()) : ''
    if (active) field.setAttribute('aria-activedescendant', active)
    else field.removeAttribute('aria-activedescendant')
  })

  // Two listeners the kit's Input does not take, on the same element and for the same reason as the
  // attributes above: composition is a property of this one field, and every pane in the app should not
  // grow a prop for it. Attached once per field, so the effect depends on the element alone.
  createEffect(() => {
    const field = input()
    if (!field) return
    const start = (): void => props.onComposing?.(true)
    const end = (): void => props.onComposing?.(false)
    field.addEventListener('compositionstart', start)
    field.addEventListener('compositionend', end)
    onCleanup(() => {
      field.removeEventListener('compositionstart', start)
      field.removeEventListener('compositionend', end)
    })
  })

  return (
    <Show when={props.palette.open()}>
      <div class="overlay-backdrop" onClick={props.palette.close}>
        <div
          class="overlay palette"
          role="dialog"
          aria-modal="true"
          aria-label={props.ariaLabel}
          aria-busy={props.busy ? 'true' : undefined}
          onKeyDown={props.palette.onKeyDown}
          onMouseDown={props.palette.onDialogMouseDown}
          onClick={(event) => event.stopPropagation()}
        >
          <Show when={props.breadcrumb?.length}>
            <div class="palette-crumbs muted">{props.breadcrumb?.join(' › ')}</div>
          </Show>
          <Input
            ref={(el) => {
              setInput(el)
              props.palette.setInputRef(el)
            }}
            kind="bare"
            placeholder={props.placeholder}
            value={props.palette.query()}
            onInput={(value) => props.palette.setQuery(value)}
          />
          <Show when={props.status}>{props.status}</Show>
          {/* Announced rather than drawn: the row count and the error already have a visible form,
              and a live region is how somebody not looking at the list hears them change. */}
          <div class="sr-only" role="status" aria-live="polite">{props.announce ?? ''}</div>
          <ul class="palette-list" id={listId} role="listbox" aria-label={props.ariaLabel}>
            <For each={props.items} fallback={<li class="palette-empty muted">{props.emptyText}</li>}>
              {(item, index) => (
                <li role="presentation">
                  <button
                    type="button"
                    id={rowId(index())}
                    role="option"
                    aria-selected={index() === props.palette.sel()}
                    // Not a tab stop: the field keeps focus and names the active row, which is what
                    // `aria-activedescendant` is for.
                    tabIndex={-1}
                    class="palette-row"
                    classList={{ selected: index() === props.palette.sel(), ...props.rowClassList?.(item) }}
                    // Hover moves the cursor without touching the query, so mouse and keyboard share one
                    // selection rather than fighting over two.
                    onMouseEnter={() => props.palette.setSel(index())}
                    onClick={() => props.onPick(item, index())}
                  >
                    {props.row(item, index() === props.palette.sel())}
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={props.footer}><div class="palette-foot muted">{props.footer}</div></Show>
        </div>
      </div>
    </Show>
  )
}
