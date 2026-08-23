import { createSignal, For, Show } from 'solid-js'
import { agentToolTone, type AgentToolRendererContribution, dispatchLayout } from '@acorn/plugin-api/client'
import { Button, StatusDot } from '@acorn/plugin-api/ui'

export const changesAgentToolRenderer: AgentToolRendererContribution = {
  id: 'changes.agent-file-tool',
  matches: (tool) => Boolean(tool.paths?.length),
  component: (props) => {
    // Seeded from the call's state, then the reader's own: a reactive `open` shuts the card on the next
    // event, since the transcript rebuilds its rows on every snapshot.
    const [open, setOpen] = createSignal(props.tool.status === 'running')
    return (
      <details
        class="agent-tool ui-fold"
        open={open()}
        onToggle={(toggle) => setOpen(toggle.currentTarget.open)}
      >
        <summary class="ui-fold-summary">
          <span class="ui-fold-marker" aria-hidden="true" />
          <StatusDot
            tone={agentToolTone(props.tool.status)}
            pulse={props.tool.status === 'running'}
            label={props.tool.status ?? 'running'}
          />
          <span class="agent-tool-name" title={props.tool.title || undefined}>
            {props.tool.title || 'Tool'}
          </span>
          <Show when={props.tool.status && props.tool.status !== 'completed'}>
            <span class="muted">{props.tool.status}</span>
          </Show>
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
    )
  },
}
