import { For, Match, Show, Switch } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { BRAND, brandMarkRegistry } from '../lib/brandMarks'
import { iconNodes as nodes } from '../lib/iconNodes'
import type { Tone } from '../tokens/tokens'

export const ICON_NAMES = Object.keys(nodes)

// Two families behind one name. See docs/ui-design.md § Icons for the resolution order and the
// `brand:` prefix, which brandMarks.ts owns because brandStyle resolves the same names.
//
// `tone` and `spin` are the two things a mark says beyond its shape, and they are here rather than at
// the call site because a call site cannot say either without a class. `tone="brand"` paints a mark in
// its own registered colour, held to the theme's contrast; every other tone is the role token.
// `spin` turns the mark, which is how a state that is in flight reads as moving.

export default function Icon(props: {
  name: string
  size?: number | string
  title?: string
  tone?: Tone | 'brand'
  spin?: boolean
}) {
  const mark = () => (props.name.startsWith(BRAND) ? brandMarkRegistry.get(props.name.slice(BRAND.length)) : undefined)
  // The brand colour reaches CSS as a custom property rather than as a token per provider, because
  // core cannot know a third party's hex (ui/brandMarks.ts states the argument). Set here so a caller
  // asking for `tone="brand"` never has to hand the mark's colour to a style attribute itself.
  const style = () => {
    const colour = props.tone === 'brand' ? mark()?.color : undefined
    return colour ? { '--brand': colour } : undefined
  }
  const shared = () => ({
    class: 'ui-icon',
    'data-tone': props.tone,
    'data-spin': props.spin ? '' : undefined,
    style: style(),
    width: props.size ?? '1em',
    height: props.size ?? '1em',
    viewBox: '0 0 24 24',
    role: props.title ? ('img' as const) : undefined,
    'aria-hidden': props.title ? undefined : true,
  })
  return (
    <Switch
      // See docs/ui-design.md § Icons: this fallback is load-bearing, not a nicety.
      fallback={
        <span
          class="ui-icon glyph"
          data-tone={props.tone}
          data-spin={props.spin ? '' : undefined}
          style={style()}
          aria-hidden={props.title ? undefined : true}
          title={props.title}
        >
          {props.name}
        </span>
      }
    >
      <Match when={mark()}>
        {(brand) => (
          <svg {...shared()} fill="currentColor">
            <Show when={props.title}>{(t) => <title>{t()}</title>}</Show>
            <path d={brand().d} />
          </svg>
        )}
      </Match>
      <Match when={nodes[props.name]}>
        {(icon) => (
          <svg
            {...shared()}
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <Show when={props.title}>{(t) => <title>{t()}</title>}</Show>
            <For each={icon()}>{([tag, attrs]) => <Dynamic component={tag} {...attrs} />}</For>
          </svg>
        )}
      </Match>
    </Switch>
  )
}
