import { For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import nodes from 'lucide-static/icon-nodes.json'

// The icon resolver (docs/ui-design.md §Icons). Contribution types carry `glyph: string`; this maps
// that string to a Lucide icon, and renders it as-is when there's no match. That fallback is
// load-bearing, not a nicety: Lucide ships no brand icons (no github/docker/linear/slack/openai), so
// the provider marks ◇ ◷ ◍ ◧ ◎ stay Unicode, as do the ~120 inline glyph literals in plugins/ that
// this pass didn't convert. Nothing goes blank mid-migration.
//
// Sized in `em` and stroked in `currentColor` so it inherits whatever already styled the glyph it
// replaced — every glyph site today sizes with font-size (--fs-lg, 9px) and colours with `color`,
// which is why converting them needed no CSS changes.
//
// ponytail: the whole set (1756 icons, ~390KB minified) is imported eagerly as one JSON module.
// That keeps <Icon> a pure lookup and makes the task-icon picker's dictionary free
// (ICON_NAMES = Object.keys). It's noise next to the bundled monaco-editor and shiki. Ceiling: if
// boot cost ever shows up, dynamic-import() the JSON from IconPicker and keep a small static map
// for the chrome icons.
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
