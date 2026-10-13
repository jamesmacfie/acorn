import { For, Show } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeNodes } from '@acorn/protocol/extensionBridge.ts'
import { State, nodeState } from './state'

// The Acorn mark, the selected Node as a chip with its status, and the gear. The chip's menu switches
// Nodes and opens Settings, where pairing and forgetting live.
export function Header(props: {
  fleet: BridgeNodes | null
  status: NodeStatus | null
  settingsOpen: boolean
  select(nodeId: string): void
  toggleSettings(): void
}) {
  let menu!: HTMLDetailsElement
  const selected = () => props.fleet?.nodes.find((node) => node.nodeId === props.fleet?.activeNodeId) ?? null
  const choose = (action: () => void) => {
    menu.open = false
    action()
  }

  return (
    <header class="top">
      <img class="mark" src="icon-128.png" alt="" />
      <span class="brand">acorn</span>
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
          <button type="button" onClick={() => choose(() => !props.settingsOpen && props.toggleSettings())}>
            Settings
          </button>
        </div>
      </details>
      <button
        type="button"
        class="icon gear"
        aria-label="Settings"
        aria-pressed={props.settingsOpen}
        onClick={() => props.toggleSettings()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  )
}
