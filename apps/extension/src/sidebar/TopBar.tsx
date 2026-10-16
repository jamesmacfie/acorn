import { Match, Show, Switch } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import type { Location } from './location'
import { nodeState } from './state'

// What the top bar names under a task or in a conversation: a task's title over its project and
// branch, tagged when the page beside the panel belongs to it, or a conversation's title under its
// task or run.
export type Heading = { title: string; eyebrow?: string; detail?: string; here?: boolean }

// The acorn, drawn in the text colour so it follows the theme.
const Acorn = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.5v2M2.5 7h11c0-2.5-2.5-3.5-5.5-3.5S2.5 4.5 2.5 7zM4 7v3l4 4.5 4-4.5V7" />
  </svg>
)

// The bar above every level, drawn from where the sidebar is. Home shows the acorn with the selected
// Node's state as a dot, and the Settings gear. A task, a conversation, and Settings show Back and
// what they are.
export function TopBar(props: {
  location: Location
  heading: Heading | null
  // The selected Node, if any, and its state, which the acorn's dot shows.
  nodeLabel: string | null
  status: NodeStatus | null
  back(): void
  openSettings(): void
}) {
  const Back = () => (
    <button type="button" class="icon" aria-label="Back" onClick={() => props.back()}>
      <Icon name="chevron-left" />
    </button>
  )
  return (
    <header class="top">
      <Switch>
        <Match when={props.location.level === 'home'}>
          <span
            class="mark"
            role="img"
            aria-label={props.nodeLabel ? `${props.nodeLabel}: ${nodeState(props.status).label}` : 'No Node'}
          >
            <Acorn />
            <span class="dot" data-tone={props.nodeLabel ? nodeState(props.status).tone : 'idle'} />
          </span>
          <span class="grow" />
          <button type="button" class="icon" aria-label="Settings" onClick={() => props.openSettings()}>
            <Icon name="settings" />
          </button>
        </Match>
        <Match when={props.location.level === 'settings'}>
          <Back />
          <div class="heading">
            <strong class="title">Settings</strong>
          </div>
        </Match>
        <Match when={props.location.level === 'task'}>
          <Back />
          <div class="heading">
            <strong class="title">{props.heading?.title}</strong>
            <span class="detail">
              {props.heading?.detail}
              <Show when={props.heading?.here}>
                <span class="here">This page</span>
              </Show>
            </span>
          </div>
        </Match>
        <Match when={props.location.level === 'conversation'}>
          <Back />
          <div class="heading">
            <span class="eyebrow">{props.heading?.eyebrow}</span>
            <strong class="title">{props.heading?.title}</strong>
          </div>
        </Match>
      </Switch>
    </header>
  )
}
