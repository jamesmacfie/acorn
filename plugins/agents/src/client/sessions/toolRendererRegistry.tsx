import { createEffect, createSignal, For, mergeProps, on, Show, type Component } from 'solid-js'
import { agentToolTone } from '@acorn/plugin-api/client'
import { CodeBlock, Fold, Inline, Stack, StatusDot, Text } from '@acorn/plugin-api/ui'
import { AGENT_TOOL_CARD_POINT, type AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Slot } from '@acorn/plugin-api/ui/host'
import { useAgentToolFold } from './toolFoldPrefs'

/** What the built-in card draws with: the point's own props plus the one thing a contributor cannot
 *  have, a callback. It is what lets "carry my last one forward" learn from this card too, and a
 *  function does not cross a port, so it stays on this side (@acorn/protocol/extensionPoints.ts). */
type AgentToolRendererProps = AgentToolCardProps & {
  /** Report a reader's toggle, so the fold setting learns from this card as well as a contributed one. */
  onOpenChange: (open: boolean) => void
}

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
  const fold = useAgentToolFold()
  // Seeded from the reader's setting, then the reader's own. A reactive `open` would shut a card the
  // moment its call finished, which is when somebody is most likely to be reading it, and the card
  // only holds this state for as long as it stays mounted — see the note on Show's children in
  // AgentEventCard for what used to remount it on every event.
  //
  // The setting, not the call's status. Status was what made this differ by harness: codex reports a
  // started call as `running`, the ACP path reports it as `pending` and never as `running` at all, so
  // one provider's cards opened themselves and the other's never did.
  const [open, setOpen] = createSignal(props.defaultOpen)
  // The reader hit "collapse all" above the composer. `defer`, so mounting is not itself a collapse:
  // the seed above already decided how this card opens, and a new card arriving after a collapse
  // starts collapsed anyway.
  createEffect(on(() => fold.collapseSignal?.(), () => setOpen(false), { defer: true }))
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
  // The slot is the only way in (docs/plugins.md § Cooperative extension points). Both render
  // paths arrive here: a compiled contributor's component and a sandboxed plugin's worker tree fill the
  // same `replace` point, and the host arbitrates between them.
  //
  // Keyed on `kind`, which is the harness's own name for what the call did — ACP's tool kind, or
  // whatever a driver normalised to it. It is the only name for a call that reaches a transcript;
  // `title` is a sentence the provider wrote for a person to read.
  return (
    <Slot
      point={AGENT_TOOL_CARD_POINT}
      key={props.tool.kind ?? ''}
      // The task this card is drawn in, so a contributor's buttons can open a pane and resolve a link
      // rather than being inert (tree/Slot.tsx § taskId). It rides `props` as well, because the owner
      // chose to tell the contributor which task it is looking at; that is the owner's word and this is
      // the host's.
      taskId={props.taskId}
      // An accessor, not a value: this is what makes a redraw one message on the port rather than a
      // worker restart and a fresh tree. `taskId` rides here rather than on the bridge because a
      // worker is shared by every card its plugin draws, in every task.
      props={() => ({ tool: props.tool, taskId: props.taskId, defaultOpen })}
    >
      <GenericAgentTool {...full} />
    </Slot>
  )
}
