import { For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { iconNodes as nodes } from './iconNodes'

export const ICON_NAMES = Object.keys(nodes)

export const hasIcon = (name: string): boolean => name in nodes

export default function Icon(props: { name: string; size?: number | string; class?: string; title?: string }) {
  return (
    <Show
      when={nodes[props.name]}
      fallback={
        <span class={`glyph ${props.class ?? ''}`} aria-hidden={props.title ? undefined : true} title={props.title}>
          {props.name}
        </span>
      }
    >
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
    </Show>
  )
}
