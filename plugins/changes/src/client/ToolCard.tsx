import { createSignal, For, lazy, Show, type Component } from 'solid-js'
import { dispatchLayout } from '@acorn/plugin-api/client'
import { agentToolTone } from '@acorn/plugin-agents/contract/toolTone.ts'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Badge, Button, CodeBlock, Fold, Inline, Stack, StatusDot } from '@acorn/plugin-api/ui'

const RecordedDiffs = lazy(() => import('./RecordedDiffs'))

// The file-tool card in an agent transcript, written entirely in the kit
// (docs/ui-design/closed-kit.md § The closed kit). Nothing here spells a class, a tag or a pixel, which is the whole
// point: the same source draws directly in the shell today and, once a plugin is loaded rather than
// compiled, through a worker and the remote root with no edit
// (docs/plugins/ui-tiers.md § Descriptors for facts, trees for UI, rectangles for pixels).
//
// What that cost: the disclosure was a hand-written `<details class="agent-tool ui-fold">` and the
// input and output were bare `<pre>`s. Fold and CodeBlock draw both, and CodeBlock brings the copy
// button and the scroll cap the hand-written version never had.

export const ChangesToolCard: Component<AgentToolCardProps> = (props) => {
  // Seeded from the reader's fold setting, then the reader's own: a reactive `open` shuts the card on
  // the next event, since the transcript rebuilds its rows on every snapshot.
  const [open, setOpen] = createSignal(props.defaultOpen)
  const status = () => props.tool.status ?? 'running'
  const label = () => (props.tool.paths ?? []).reduce(
    (title, path) => title.replaceAll(path, path.split(/[/\\]/).slice(-2).join('/')),
    props.tool.title || 'Tool',
  )
  const openChanges = () => dispatchLayout(props.taskId, { type: 'show', pane: 'changes' })
  // Badge has no `muted`, which is what a pending call's dot is. `neutral` is the same meaning in
  // the tone set a Badge does have.
  const badgeTone = () => {
    const tone = agentToolTone(props.tool.status)
    return tone === 'muted' ? 'neutral' : tone
  }
  return (
    <Fold
      label={label()}
      open={open()}
      onOpenChange={setOpen}
      meta={
        <Inline gap="inline">
          <StatusDot tone={agentToolTone(props.tool.status)} pulse={status() === 'running'} label={status()} />
          {/* The dot carries a finished call's state; the word beside it is only worth the space
              while the call is still going. A Badge rather than a bare span, because the kit has no
              inline text node and this is a state word, which is what a Badge is. */}
          <Show when={status() !== 'completed'}>
            <Badge tone={badgeTone()} size="xs">{status()}</Badge>
          </Show>
        </Inline>
      }
    >
      <Stack gap="row">
        <Show when={props.tool.input}>{(input) => <CodeBlock copy maxHeight="block">{input()}</CodeBlock>}</Show>
        <Show when={props.tool.output}>{(output) => <CodeBlock copy maxHeight="block">{output()}</CodeBlock>}</Show>
        <Show when={props.fileChanges?.length}>
          <RecordedDiffs changes={props.fileChanges ?? []} onOpenChanges={openChanges} />
        </Show>
        <For each={(props.tool.paths ?? []).filter((path) => !props.fileChanges?.some((change) => change.path === path))}>
          {(path) => (
            <Button
              variant="bare"
              onPress={openChanges}
            >
              {path}
            </Button>
          )}
        </For>
      </Stack>
    </Fold>
  )
}
