import { For, Show } from 'solid-js'
import { dispatchLayout } from '../../../core/client/tasks/tasks'
import type { AgentToolRendererContribution } from '../../../core/client/registries/agentToolRenderers'

export const changesAgentToolRenderer: AgentToolRendererContribution = {
  id: 'changes.agent-file-tool',
  matches: (tool) => Boolean(tool.paths?.length),
  component: (props) => (
    <details class="agent-tool" open={props.tool.status === 'running'}>
      <summary>
        <span class="agent-tool-state" data-state={props.tool.status} />
        <span>{props.tool.title}</span>
        <span class="muted">{props.tool.status}</span>
      </summary>
      <Show when={props.tool.input}><pre>{props.tool.input}</pre></Show>
      <Show when={props.tool.output}><pre>{props.tool.output}</pre></Show>
      <For each={props.tool.paths ?? []}>
        {(path) => (
          <button
            type="button"
            class="agent-path-link"
            onClick={() => dispatchLayout(props.taskId, { type: 'show', pane: 'changes' })}
          >
            {path}
          </button>
        )}
      </For>
    </details>
  ),
}
