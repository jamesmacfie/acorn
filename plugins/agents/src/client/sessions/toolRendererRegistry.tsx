import { createEffect, createSignal, For, mergeProps, on, onCleanup, Show, type Component } from 'solid-js'
import { agentToolTone } from '../../contract/toolTone'
import { CodeBlock, Fold, Inline, Stack, StatusDot, Text } from '@acorn/plugin-api/ui'
import { formatRelativeTime } from '@acorn/plugin-api/client'
import { AGENT_TOOL_CARD_POINT, type AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Slot } from '@acorn/plugin-api/ui/host'
import { useAgentToolFold } from './toolFoldPrefs'
import { WebToolBody, webSummary } from './webToolCard'
import { eventTime } from './eventTime'
import type { AgentToolCall } from '../../contract/wire.ts'

/** What the built-in card draws with: the point's props plus host-only metadata and a callback.
 *  The callback lets "carry my last one forward" learn from this card too. It cannot cross a port,
 *  so it stays on this side (@acorn/protocol/extensionPoints.ts). */
type AgentToolRendererProps = AgentToolCardProps & {
  /** The first recorded update, used only by the built-in expanded body. */
  createdAt: number
  /** Report a reader's toggle, so the fold setting learns from this card as well as a contributed one. */
  onOpenChange: (open: boolean) => void
}

// One clock for every open built-in tool body. A transcript can open hundreds of folds at once.
const [now, setNow] = createSignal(Date.now())
let clockReaders = 0
let clockTimer: ReturnType<typeof setInterval> | undefined

function useOpenToolClock(open: () => boolean): () => number {
  createEffect(() => {
    if (!open()) return
    if (clockReaders++ === 0) {
      setNow(Date.now())
      clockTimer = setInterval(() => setNow(Date.now()), 60_000)
    }
    onCleanup(() => {
      if (--clockReaders === 0) clearInterval(clockTimer)
    })
  })
  return now
}

// A call with no status reported yet is in flight; see AgentToolCall.status.
const toolStatusLabel = (props: AgentToolRendererProps) => props.tool.status ?? 'running'

// Claude's Skill call has a generic provider title, while its useful name is in the recorded input.
// Read it at presentation time so older transcript rows get the same label without rewriting events.
function skillLabel(tool: AgentToolCall): string | undefined {
  if (tool.title !== 'Skill' || !tool.input) return undefined
  try {
    const input: unknown = JSON.parse(tool.input)
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
    const skill = (input as Record<string, unknown>).skill
    return typeof skill === 'string' && skill.trim() ? `Launching skill: ${skill.trim()}` : undefined
  } catch {
    return undefined
  }
}

const toolLabel = (tool: AgentToolCall): string => skillLabel(tool) ?? (tool.title || 'Tool')

/** The state half: a dot, and the word beside it while the call is not finished. The dot carries a
 *  finished call's state on its own, and the word beside it used to read as the entire card whenever
 *  a provider sent its updates without a title.
 *
 *  A web call adds its one-line summary here, in the fold's `meta` slot, rather than to the label: the
 *  label is the row's accessible name and it is what a reader scans a transcript by, so it stays the
 *  stable `Search web` while the query — which can be a paragraph — sits beside it. */
const AgentToolState: Component<AgentToolRendererProps> = (props) => {
  const summary = () => (props.tool.web ? webSummary(props.tool.web) : undefined)
  return (
    <Inline>
      <StatusDot
        tone={agentToolTone(props.tool.status)}
        pulse={toolStatusLabel(props) === 'running'}
        label={toolStatusLabel(props)}
      />
      <Show when={toolStatusLabel(props) !== 'completed'}>
        <Text emphasis="muted">{toolStatusLabel(props)}</Text>
      </Show>
      <Show when={summary()}>{(text) => <Text emphasis="muted">{text()}</Text>}</Show>
    </Inline>
  )
}

/** The flat card: a call with nothing to open onto. The provider's own name for it, which for a
 *  shell command is the command itself. */
const AgentToolHead: Component<AgentToolRendererProps> = (props) => (
  <Inline>
    <AgentToolState {...props} />
    <Text>{toolLabel(props.tool)}</Text>
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
  const clock = useOpenToolClock(open)
  const started = () => `${eventTime(props.createdAt).full} · ${formatRelativeTime(props.createdAt, clock())}`
  const output = () => {
    const text = props.tool.output
    return text?.trim() === skillLabel(props.tool) ? undefined : text
  }
  // The reader hit "collapse all" above the composer. `defer`, so mounting is not itself a collapse:
  // the seed above already decided how this card opens, and a new card arriving after a collapse
  // starts collapsed anyway.
  createEffect(on(() => fold.collapseSignal?.(), () => setOpen(false), { defer: true }))
  return (
    <Fold
      label={toolLabel(props.tool)}
      level="sub"
      meta={<AgentToolState {...props} />}
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        props.onOpenChange(next)
      }}
    >
      {/* Web activity gets its own body, and it is chosen on the payload rather than on `kind`, a
          harness id or a tool name: any driver that fills in `tool.web` draws this card. The
          pretty-printed `input` is dropped there, because it is the same query said again as JSON. */}
      <Show
        when={props.tool.web}
        fallback={
          <Stack gap="row">
            <Show when={props.tool.input}>{(input) => <CodeBlock wrap maxHeight="block">{input()}</CodeBlock>}</Show>
            <Text emphasis="muted">Started {started()}</Text>
            <Show when={output()}>
              {(output) => <CodeBlock wrap maxHeight="block">{output()}</CodeBlock>}
            </Show>
            <For each={props.tool.paths ?? []}>{(path) => <Text emphasis="mono">{path}</Text>}</For>
          </Stack>
        }
      >
        {(web) => (
          <Stack gap="row">
            <Text emphasis="muted">Started {started()}</Text>
            <WebToolBody web={web()} output={props.tool.output} />
          </Stack>
        )}
      </Show>
    </Fold>
  )
}

const GenericAgentTool: Component<AgentToolRendererProps> = (props) => (
  <Show
    when={props.tool.input || props.tool.output || props.tool.paths?.length || props.tool.web}
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
