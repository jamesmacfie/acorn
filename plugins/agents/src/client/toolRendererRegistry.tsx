import { For, Show, type Component } from 'solid-js'
import { agentToolTone, type AgentToolRendererProps, agentToolRendererRegistry } from '@acorn/plugin-api/client'
import { StatusDot } from '@acorn/plugin-api/ui'

export type {
  AgentToolRendererContribution,
  AgentToolRendererProps,
} from '@acorn/plugin-api/client'

const GenericAgentTool: Component<AgentToolRendererProps> = (props) => (
  <details class="agent-tool" open={props.tool.status === 'running'}>
    <summary>
      <StatusDot tone={agentToolTone(props.tool.status)} />
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
