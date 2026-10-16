import { Match, Show, Switch, type JSX } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import { Button, Kbd } from '@acorn/client-core/kit/components/primitives.tsx'
import { formatChord } from '@acorn/client-core/kit/lib/formatChord'
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

// The key that opens Go to task, as the panel writes it: ⌘K on a Mac, Ctrl+K elsewhere.
const GO_TO_TASK_KEYS = formatChord(/Mac/.test(navigator.userAgent) ? 'meta+k' : 'ctrl+k')

// The bar above every level, drawn from where the sidebar is. While the panel gets connected it's bare:
// the acorn and "Acorn", and Cancel on a pairing step that has somewhere to go back to. Home shows the acorn with the selected
// Node's state as a dot, Go to task, Needs you, and the Settings gear. A task, a conversation, and Settings show
// Back and what they are, and a task's title opens Go to task too.
export function TopBar(props: {
  location: Location
  // Installing the bridge or pairing, when nothing else works yet.
  bare: boolean
  cancel?: () => void
  heading: Heading | null
  // The selected Node, if any, and its state, which the acorn's dot shows.
  nodeLabel: string | null
  status: NodeStatus | null
  // The ⋯ menu for the task or conversation shown, if any.
  menu?: JSX.Element
  // The Needs you button, on Home, a task, and a conversation.
  needsYou?: JSX.Element
  ref(element: HTMLElement): void
  back(): void
  openSettings(): void
  goToTask(): void
}) {
  const Back = () => <IconButton icon="chevron-left" label="Back" size="md" onPress={() => props.back()} />
  return (
    <header class="top" ref={props.ref}>
      <Switch>
        <Match when={props.bare}>
          <span class="mark">
            <Acorn />
          </span>
          <strong class="grow">Acorn</strong>
          <Show when={props.cancel}>
            {(cancel) => <IconButton icon="x" label="Cancel" size="md" onPress={() => cancel()()} />}
          </Show>
        </Match>
        <Match when={props.location.level === 'home'}>
          <span
            class="mark"
            role="img"
            aria-label={props.nodeLabel ? `${props.nodeLabel}: ${nodeState(props.status).label}` : 'No Node'}
          >
            <Acorn />
            <span class="dot" data-tone={props.nodeLabel ? nodeState(props.status).tone : 'idle'} />
          </span>
          <Show when={props.nodeLabel} fallback={<span class="grow" />}>
            <span class="go-to-task-button">
              <Button label="Go to task" variant="bare" opens="dialog" onPress={() => props.goToTask()}>
                <Icon name="search" />
                <span class="grow">Go to task</span>
                <Kbd size="xs">{GO_TO_TASK_KEYS}</Kbd>
              </Button>
            </span>
          </Show>
          {props.needsYou}
          <IconButton icon="settings" label="Settings" size="md" onPress={() => props.openSettings()} />
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
            <Button variant="bare" opens="dialog" onPress={() => props.goToTask()}>
              <strong class="title">
                {props.heading?.title}
                <Icon name="chevron-down" tone="muted" />
              </strong>
              <span class="detail">
                {props.heading?.detail}
                <Show when={props.heading?.here}>
                  <span class="here">This page</span>
                </Show>
              </span>
            </Button>
          </div>
          {props.needsYou}
          {props.menu}
        </Match>
        <Match when={props.location.level === 'conversation'}>
          <Back />
          <div class="heading">
            <span class="eyebrow">{props.heading?.eyebrow}</span>
            <strong class="title">{props.heading?.title}</strong>
          </div>
          {props.needsYou}
          {props.menu}
        </Match>
      </Switch>
    </header>
  )
}
