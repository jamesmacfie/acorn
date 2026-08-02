import { For, Show, type Component } from 'solid-js'
import {
  agentToolRendererRegistry,
  type AgentToolRendererProps,
} from '@acorn/client-core/registries/agentToolRenderers.ts'

export type {
  AgentToolRendererContribution,
  AgentToolRendererProps,
} from '@acorn/client-core/registries/agentToolRenderers.ts'

const GenericAgentTool: Component<AgentToolRendererProps> = (props) => (
  <details class="agent-tool" open={props.tool.status === 'running'}>
    <summary>
      <span class="agent-tool-state" data-state={props.tool.status} />
      <span>{props.tool.title}</span>
      <span class="muted">{props.tool.status}</span>
    </summary>
    <Show when={props.tool.input}><pre>{props.tool.input}</pre></Show>
    <Show when={props.tool.output}><pre>{props.tool.output}</pre></Show>
    <For each={props.tool.paths ?? []}>
      {(path) => <span class="agent-path-link">{path}</span>}
    </For>
  </details>
)

export const AgentToolCallCard: Component<AgentToolRendererProps> = (props) => {
  const contribution = () =>
    agentToolRendererRegistry.entries().find((candidate) => candidate.matches(props.tool))
  return contribution()?.component(props) ?? <GenericAgentTool {...props} />
}
