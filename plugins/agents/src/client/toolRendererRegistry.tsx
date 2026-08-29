import { createSignal, For, mergeProps, Show, type Component } from 'solid-js'
import { agentToolTone, type AgentToolRendererProps, agentToolRendererRegistry } from '@acorn/plugin-api/client'
import { CodeBlock, Fold, Inline, Stack, StatusDot, Text } from '@acorn/plugin-api/ui'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'
import { Slot } from '@acorn/plugin-api/ui/host'
import { useAgentToolFold } from './toolFoldPrefs'

export type {
  AgentToolRendererContribution,
  AgentToolRendererProps,
} from '@acorn/plugin-api/client'

// A call with no status reported yet is in flight; see AgentToolCall.status.
const toolStatusLabel = (props: AgentToolRendererProps) => props.tool.status ?? 'running'

/** The state half: a dot, and the word beside it while the call is not finished. The dot carries a
 *  finished call's state on its own, and the word beside it used to read as the entire card whenever
 *  a provider sent its updates without a title. */
const AgentToolState: Component<AgentToolRendererProps> = (props) => (
  <Inline>
    <StatusDot
      tone={agentToolTone(props.tool.status)}
      pulse={toolStatusLabel(props) === 'running'}
      label={toolStatusLabel(props)}
    />
    <Show when={toolStatusLabel(props) !== 'completed'}>
      <Text emphasis="muted">{toolStatusLabel(props)}</Text>
    </Show>
  </Inline>
)

/** The flat card: a call with nothing to open onto. The provider's own name for it, which for a
 *  shell command is the command itself. */
const AgentToolHead: Component<AgentToolRendererProps> = (props) => (
  <Inline>
    <AgentToolState {...props} />
    <Text>{props.tool.title || 'Tool'}</Text>
  </Inline>
)

// A disclosure with nothing behind it is worse than no disclosure: the reader clicks a card that opens
// onto nothing. Providers report plenty of calls with neither output nor a path, so those render flat.
const AgentToolFold: Component<AgentToolRendererProps> = (props) => {
  // Seeded from the reader's setting, then the reader's own. A reactive `open` would shut a card the
  // moment its call finished, which is when somebody is most likely to be reading it, and the card
  // only holds this state for as long as it stays mounted — see the note on Show's children in
  // AgentEventCard for what used to remount it on every event.
  //
  // The setting, not the call's status. Status was what made this differ by harness: codex reports a
  // started call as `running`, the ACP path reports it as `pending` and never as `running` at all, so
  // one provider's cards opened themselves and the other's never did.
  const [open, setOpen] = createSignal(props.defaultOpen)
  return (
    <Fold
      label={props.tool.title || 'Tool'}
      level="sub"
      meta={<AgentToolState {...props} />}
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        props.onOpenChange(next)
      }}
    >
      <Stack gap="row">
        <Show when={props.tool.input}>{(input) => <CodeBlock wrap maxHeight="block">{input()}</CodeBlock>}</Show>
        <Show when={props.tool.output}>{(output) => <CodeBlock wrap maxHeight="block">{output()}</CodeBlock>}</Show>
        <For each={props.tool.paths ?? []}>{(path) => <Text emphasis="mono">{path}</Text>}</For>
      </Stack>
    </Fold>
  )
}

const GenericAgentTool: Component<AgentToolRendererProps> = (props) => (
  <Show
    when={props.tool.input || props.tool.output || props.tool.paths?.length}
    fallback={<AgentToolHead {...props} />}
  >
    <AgentToolFold {...props} />
  </Show>
)

/**
 * Resolves the reader's fold setting once and hands it to whichever renderer draws this call, the
 * built-in one or a contributed one. Here rather than in the transcript so a contributed renderer
 * honours the setting without the transcript having to pass anything down for it.
 */
export const AgentToolCallCard: Component<Omit<AgentToolRendererProps, 'defaultOpen' | 'onOpenChange'>> = (props) => {
  const fold = useAgentToolFold()
  // Read at mount and not tracked, because the seed in the fold is not either: changing the setting
  // decides how the next card opens, it does not reach back and reopen every card the reader has shut.
  const defaultOpen = fold.startsOpen()
  // `mergeProps`, not a spread: a spread would read `props.tool` once and freeze it, and the transcript
  // hands out a fresh tool object on every snapshot.
  const full = mergeProps(props, { defaultOpen, onOpenChange: fold.onToggle })
  const contribution = () =>
    agentToolRendererRegistry.entries().find((candidate) => candidate.matches(props.tool))
  // The first slot in the shell (docs/future/layout/06-remote-tree.md § Slots are nodes). A compiled
  // renderer still wins, because a first-party card is drawn in the same realm as the transcript and
  // costs nothing; a sandboxed plugin fills the card only where nothing compiled claimed it.
  //
  // Keyed on `kind`, which is the harness's own name for what the call did — ACP's tool kind, or
  // whatever a driver normalised to it. It is the only name for a call that reaches a transcript;
  // `title` is a sentence the provider wrote for a person to read.
  return (
    <Show when={!contribution()} fallback={contribution()!.component(full)}>
      <Slot
        point={AGENT_TOOL_CARD_POINT}
        key={props.tool.kind ?? ''}
        // An accessor, not a value: this is what makes a redraw one message on the port rather than a
        // worker restart and a fresh tree. `taskId` rides here rather than on the bridge because a
        // worker is shared by every card its plugin draws, in every task.
        props={() => ({ tool: props.tool, taskId: props.taskId, defaultOpen })}
      >
        <GenericAgentTool {...full} />
      </Slot>
    </Show>
  )
}
