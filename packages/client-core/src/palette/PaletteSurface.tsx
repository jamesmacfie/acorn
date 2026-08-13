import { For, Show, type JSX } from 'solid-js'
import { Input } from '../ui/primitives'
import type { OverlayPalette } from './overlay'
// The component owns its stylesheet, so a consumer cannot depend on some other palette having been
// mounted first to get the chrome styled.
import './palette.css'

// The palette markup, deduped. Four surfaces rendered the same
// backdrop → dialog → input → list → empty structure, wiring the same seven handlers from
// createOverlayPalette by hand, and github's file finder had its own `.finder-*` class vocabulary
// for exactly the same thing.
//
// Beside the hook rather than in ui/: it imports OverlayPalette's type, and the ui/ purity rule
// carves out `palette/model.ts` only. Behaviour stays entirely in the hook — this is the chrome.
//
// Each caller keeps its own row body. The palettes render label+hint, the file finders render
// dir+name, and the workspace palette leads with a colour dot; a shared row shape would have to
// grow a slot per caller, which is the markup it is replacing.
//
// Deliberately NOT absorbing Picker (anchored, filtered, non-modal) or Modal. The three-way
// distinction is argued in Modal.tsx and dismissable.ts; this completes the palette leg only.
export function PaletteSurface<T>(props: {
  palette: OverlayPalette
  items: readonly T[]
  placeholder: string
  emptyText: string
  /** The row's contents. `selected` is the keyboard cursor, not a persistent selection. */
  row: (item: T, selected: boolean) => JSX.Element
  /** Per-row state classes — the command palette marks a source's error row. */
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
                    // Hover moves the cursor without touching the query, so mouse and keyboard
                    // share one selection rather than fighting over two.
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
