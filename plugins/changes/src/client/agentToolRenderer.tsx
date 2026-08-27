import { createSignal, For, Show } from 'solid-js'
import { agentToolTone, type AgentToolRendererContribution, dispatchLayout } from '@acorn/plugin-api/client'
import { Button, StatusDot } from '@acorn/plugin-api/ui'

export const changesAgentToolRenderer: AgentToolRendererContribution = {
  id: 'changes.agent-file-tool',
  matches: (tool) => Boolean(tool.paths?.length),
  component: (props) => {
    // Seeded from the reader's fold setting, then the reader's own: a reactive `open` shuts the card on
    // the next event, since the transcript rebuilds its rows on every snapshot. `onOpenChange` is what
    // lets the "carry my last one forward" setting learn from this card as well as the built-in one.
    const [open, setOpen] = createSignal(props.defaultOpen)
    return (
      <details
        class="agent-tool ui-fold"
        open={open()}
        onToggle={(toggle) => {
          setOpen(toggle.currentTarget.open)
          props.onOpenChange(toggle.currentTarget.open)
        }}
      >
        <summary class="ui-fold-summary">
          <span class="ui-fold-marker" aria-hidden="true" />
          <StatusDot
            tone={agentToolTone(props.tool.status)}
            pulse={props.tool.status === 'running'}
            label={props.tool.status ?? 'running'}
          />
          {/* The shared truncation utility, not agents' `.agent-tool-name`: the card wears the host's
              vocabulary for the box it sits in, but ellipsising its own label is nobody's business. */}
          <span class="truncate" title={props.tool.title || undefined}>
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
