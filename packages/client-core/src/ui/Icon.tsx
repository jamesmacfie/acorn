import { For, Match, Show, Switch } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { brandMarkRegistry } from './brandMarks'
import { iconNodes as nodes } from './iconNodes'

export const ICON_NAMES = Object.keys(nodes)

// Two families behind one name. A bare name is a Lucide glyph: stroked, unfilled, 24 box. A
// `brand:`-prefixed name is a brand mark from brandMarks.ts: one filled path, same box. The prefix
// keeps brand marks out of ICON_NAMES, which IconPicker enumerates for user-chosen workspace and
// task icons, and stays unambiguous if Lucide ever grows brand-shaped names back.
const BRAND = 'brand:'

export default function Icon(props: { name: string; size?: number | string; class?: string; title?: string }) {
  const brand = () => (props.name.startsWith(BRAND) ? brandMarkRegistry.get(props.name.slice(BRAND.length)) : undefined)
  return (
    <Switch
      // Still load-bearing rather than a nicety: an unmatched name renders as text, which the
      // remaining inline literals (◆/◇ pin state, ⊘/◉ hidden) depend on.
      fallback={
        <span class={`glyph ${props.class ?? ''}`} aria-hidden={props.title ? undefined : true} title={props.title}>
          {props.name}
        </span>
      }
    >
      <Match when={brand()}>
        {(mark) => (
          <svg
            class={props.class}
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
            class={props.class}
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
