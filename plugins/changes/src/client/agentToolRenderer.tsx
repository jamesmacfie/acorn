import { For, Show } from 'solid-js'
import { agentToolTone, type AgentToolRendererContribution, dispatchLayout } from '@acorn/plugin-api/client'
import { Button, StatusDot } from '@acorn/plugin-api/ui'

export const changesAgentToolRenderer: AgentToolRendererContribution = {
  id: 'changes.agent-file-tool',
  matches: (tool) => Boolean(tool.paths?.length),
  component: (props) => (
    <details class="agent-tool" open={props.tool.status === 'running'}>
      <summary>
        <StatusDot tone={agentToolTone(props.tool.status)} />
        <span>{props.tool.title}</span>
        <span class="muted">{props.tool.status}</span>
      </summary>
      <Show when={props.tool.input}><pre>{props.tool.input}</pre></Show>
      <Show when={props.tool.output}><pre>{props.tool.output}</pre></Show>
      <For each={props.tool.paths ?? []}>
        {(path) => (
          <Button
            variant="bare"
            class="agent-path-link"
            onClick={() => dispatchLayout(props.taskId, { type: 'show', pane: 'changes' })}
          >
            {path}
          </Button>
        )}
      </For>
    </details>
  ),
}
