import { For, Show } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeNodes } from '@acorn/protocol/extensionBridge.ts'
import { State, nodeState } from './state'

// What the top bar names: a view, with a count for a list, or an open conversation with its task in
// small letters above it and a way back to the list.
export type Heading = { title: string; count?: number; eyebrow?: string; back?: () => void }

// The view's heading, drawn like a desktop pane header, then the selected Node as a chip with its
// status. The browser's own panel header already says Acorn. The chip's menu switches Nodes, pairs
// another, and forgets the selected one.
export function Header(props: {
  heading: Heading
  fleet: BridgeNodes | null
  status: NodeStatus | null
  select(nodeId: string): void
  pair(): void
  forget(nodeId: string): void
}) {
  let menu!: HTMLDetailsElement
  const selected = () => props.fleet?.nodes.find((node) => node.nodeId === props.fleet?.activeNodeId) ?? null
  const choose = (action: () => void) => {
    menu.open = false
    action()
  }

  return (
    <header class="top">
      <Show when={props.heading.back}>
        {(back) => (
          <button type="button" class="icon" aria-label="Back" onClick={() => back()()}>
            ‹
          </button>
        )}
      </Show>
      <div class="heading" data-eyebrow={props.heading.eyebrow === undefined ? undefined : ''}>
        <Show when={props.heading.eyebrow}>{(eyebrow) => <span class="eyebrow">{eyebrow()}</span>}</Show>
        <h1>
          {props.heading.title}
          <Show when={props.heading.count !== undefined}>
            <span class="count">{props.heading.count}</span>
          </Show>
        </h1>
      </div>
      <details class="menu" ref={menu}>
        <summary class="chip" aria-label="Node">
          <Show when={selected()} fallback={<State tone="idle">No Node</State>}>
            {(node) => <State tone={nodeState(props.status).tone}>{node().label}</State>}
          </Show>
        </summary>
        <div class="menu-items">
          <For each={props.fleet?.nodes}>
            {(node) => (
              <button
                type="button"
                aria-current={node.nodeId === props.fleet?.activeNodeId}
                onClick={() => choose(() => props.select(node.nodeId))}
              >
                {node.label}
              </button>
            )}
          </For>
          <button type="button" onClick={() => choose(props.pair)}>
            Pair another
          </button>
          <Show when={selected()}>
            {(node) => (
              <button type="button" onClick={() => choose(() => props.forget(node().nodeId))}>
                Forget {node().label}
              </button>
            )}
          </Show>
        </div>
      </details>
    </header>
  )
}
