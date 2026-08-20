import { For, Show, type JSX } from 'solid-js'
import { Input } from '../ui/primitives'
import type { OverlayPalette } from './overlay'
// The component owns its stylesheet, so a consumer can't depend on some other palette having been
// mounted first to get the chrome styled.
import './palette.css'

// The palette markup, deduped. Four surfaces rendered the same backdrop, dialog, input, list and empty
// structure, wiring the same seven handlers from createOverlayPalette by hand, and github's file finder
// had its own `.finder-*` class vocabulary for the same thing.
//
// Beside the hook rather than in ui/, because it imports OverlayPalette's type and the ui/ purity rule
// carves out `palette/model.ts` only. Behaviour stays in the hook; this is the chrome.
//
// Each caller keeps its own row body: the palettes render label and hint, the file finders render dir
// and name, and the workspace palette leads with a colour dot. A shared row shape would grow a slot per
// caller, which is the markup it's replacing.
//
// Deliberately not absorbing Picker (anchored, filtered, non-modal) or Modal. The three-way distinction
// is argued in Modal.tsx and dismissable.ts.
export function PaletteSurface<T>(props: {
  palette: OverlayPalette
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
  /** Extra content between the input and the list — an error banner. */
  status?: JSX.Element
  class?: string
  ariaLabel?: string
}) {
  return (
    <Show when={props.palette.open()}>
      <div class="overlay-backdrop" onClick={props.palette.close}>
        <div
          class="overlay palette"
          role="dialog"
          aria-modal="true"
          aria-label={props.ariaLabel}
          onKeyDown={props.palette.onKeyDown}
          onMouseDown={props.palette.onDialogMouseDown}
          onClick={(event) => event.stopPropagation()}
        >
          <Input
            ref={props.palette.setInputRef}
            kind="bare"
            class="palette-input"
            placeholder={props.placeholder}
            value={props.palette.query()}
            onInput={(event) => props.palette.setQuery(event.currentTarget.value)}
          />
          <Show when={props.status}>{props.status}</Show>
          <ul class="palette-list">
            <For each={props.items} fallback={<li class="palette-empty muted">{props.emptyText}</li>}>
              {(item, index) => (
                <li>
                  <button
                    type="button"
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
