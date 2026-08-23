import { createSignal, For, Show, type Component } from 'solid-js'
import { agentToolTone, type AgentToolRendererProps, agentToolRendererRegistry } from '@acorn/plugin-api/client'
import { StatusDot } from '@acorn/plugin-api/ui'

export type {
  AgentToolRendererContribution,
  AgentToolRendererProps,
} from '@acorn/plugin-api/client'

// A call with no status reported yet is in flight; see AgentToolCall.status.
const toolStatusLabel = (props: AgentToolRendererProps) => props.tool.status ?? 'running'

/** Dot, name, and state, for both the expandable and the flat card. */
const AgentToolHead: Component<AgentToolRendererProps> = (props) => (
  <>
    <StatusDot
      tone={agentToolTone(props.tool.status)}
      pulse={toolStatusLabel(props) === 'running'}
      label={toolStatusLabel(props)}
    />
    {/* The provider's own name for the call, which for a shell command is the command itself. Held to
        one line, with the whole of it on hover, because those run long. */}
    <span class="agent-tool-name" title={props.tool.title || undefined}>{props.tool.title || 'Tool'}</span>
    {/* The dot carries a finished call's state, and the word beside it used to read as the entire card
        whenever a provider sent its updates without a title. */}
    <Show when={toolStatusLabel(props) !== 'completed'}>
      <span class="muted">{toolStatusLabel(props)}</span>
    </Show>
  </>
)

// A disclosure with nothing behind it is worse than no disclosure: the reader clicks a card that opens
// onto nothing. Providers report plenty of calls with neither output nor a path, so those render flat.
const AgentToolFold: Component<AgentToolRendererProps> = (props) => {
  // Seeded from the call's state, then the reader's own, the way the subagent card does it. A reactive
  // `open` would shut a card the moment its call finished, which is when somebody is most likely to be
  // reading it. Seeding here rather than in the parent is what still opens a call whose output streams
  // while it runs, and the card only holds that state for as long as it stays mounted — see the note on
  // Show's children in AgentEventCard for what used to remount it on every event.
  const [open, setOpen] = createSignal(props.tool.status === 'running')
  return (
    <details
      class="agent-tool ui-fold"
      open={open()}
      onToggle={(toggle) => setOpen(toggle.currentTarget.open)}
    >
      <summary class="ui-fold-summary">
        <span class="ui-fold-marker" aria-hidden="true" />
        <AgentToolHead {...props} />
      </summary>
      <Show when={props.tool.input}><pre>{props.tool.input}</pre></Show>
      <Show when={props.tool.output}><pre>{props.tool.output}</pre></Show>
      <For each={props.tool.paths ?? []}>
        {(path) => <span class="agent-path-link">{path}</span>}
      </For>
    </details>
  )
}

const GenericAgentTool: Component<AgentToolRendererProps> = (props) => (
  <Show
    when={props.tool.input || props.tool.output || props.tool.paths?.length}
    fallback={<div class="agent-tool agent-tool-flat"><AgentToolHead {...props} /></div>}
  >
    <AgentToolFold {...props} />
  </Show>
)

export const AgentToolCallCard: Component<AgentToolRendererProps> = (props) => {
  const contribution = () =>
    agentToolRendererRegistry.entries().find((candidate) => candidate.matches(props.tool))
  return contribution()?.component(props) ?? <GenericAgentTool {...props} />
}
