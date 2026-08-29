import { For, Match, Show, Switch } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { BRAND, brandMarkRegistry } from './brandMarks'
import { iconNodes as nodes } from './iconNodes'

export const ICON_NAMES = Object.keys(nodes)

// Two families behind one name. See docs/ui-design.md § Icons for the resolution order and the
// `brand:` prefix, which brandMarks.ts owns because brandStyle resolves the same names.

export default function Icon(props: { name: string; size?: number | string; title?: string }) {
  const brand = () => (props.name.startsWith(BRAND) ? brandMarkRegistry.get(props.name.slice(BRAND.length)) : undefined)
  return (
    <Switch
      // See docs/ui-design.md § Icons: this fallback is load-bearing, not a nicety.
      fallback={
        <span class="glyph" aria-hidden={props.title ? undefined : true} title={props.title}>
          {props.name}
        </span>
      }
    >
      <Match when={brand()}>
        {(mark) => (
          <svg
            
            width={props.size ?? '1em'}
            height={props.size ?? '1em'}
            viewBox="0 0 24 24"
            fill="currentColor"
            role={props.title ? 'img' : undefined}
            aria-hidden={props.title ? undefined : true}
          >
            <Show when={props.title}>{(t) => <title>{t()}</title>}</Show>
            <path d={mark().d} />
          </svg>
        )}
      </Match>
      <Match when={nodes[props.name]}>
        {(icon) => (
          <svg
            
            width={props.size ?? '1em'}
            height={props.size ?? '1em'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            role={props.title ? 'img' : undefined}
            aria-hidden={props.title ? undefined : true}
          >
            <Show when={props.title}>{(t) => <title>{t()}</title>}</Show>
            <For each={icon()}>{([tag, attrs]) => <Dynamic component={tag} {...attrs} />}</For>
          </svg>
        )}
      </Match>
    </Switch>
  )
}
