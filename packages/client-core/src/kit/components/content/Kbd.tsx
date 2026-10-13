import { For, Show, type JSX } from 'solid-js'
import { chordKeys } from '../../lib/rendering/formatChord'
import type { Size } from '../../tokens/tokens'

/* Kbd: a shortcut drawn as one cap per key, `⇧⌘G` as three. A cap's height is fixed and its glyph
   centred, so it cannot grow the line-height of the row it sits in. Only a string can be split; any
   other child draws as one cap. */
export function Kbd(props: { size?: Extract<Size, 'xs' | 'sm'>; children: JSX.Element }) {
  return (
    <kbd class="ui-kbd" data-size={props.size ?? 'sm'}>
      <Show when={typeof props.children === 'string'} fallback={<kbd class="ui-kbd-key">{props.children}</kbd>}>
        <For each={chordKeys(props.children as string)}>
          {(step) => (
            <span class="ui-kbd-step">
              <For each={step}>{(key) => <kbd class="ui-kbd-key">{key}</kbd>}</For>
            </span>
          )}
        </For>
      </Show>
    </kbd>
  )
}
