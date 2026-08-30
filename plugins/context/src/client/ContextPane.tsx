import { createEffect, For, onCleanup, onMount, Show } from 'solid-js'
import { bytesOf, clientEvents, consumePaneIntent, formatSize, type PaneIntent, type Task } from '@acorn/plugin-api/client'
import type { ContextItem, TaskContext } from '@acorn/protocol/api.ts'
import {
  Alert, Badge, Button, Checkbox, CodeBlock, EmptyState, Fold, Heading, Inline, Meter, Picker, Row, Rows,
  Stack, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import { collectionId, pillText, sessionLabel, type ContextModel } from './contextModel'
import { CONTEXT_SECTION_POINT } from './sectionPoint'

// The three regions of the Context pane (docs/agent-tools.md § Context sections). The host draws the
// header, the scrolling body and the pinned footer; these fill them. Everything they share is in
// ./contextModel.ts.

type Section = TaskContext['sections'][number]

const originBadge = (author?: 'user' | 'agent' | 'workflow'): string =>
  (author === 'agent' ? '🤖' : author === 'workflow' ? 'seed' : '')
const scopePill = (scope?: string): string =>
  (scope === 'task' ? '◆ task' : scope === 'workspace' ? 'ws' : scope === 'global' ? '🌐' : '')

export function ContextHeader(props: { task: Task; model: ContextModel }) {
  const model = () => props.model
  return (
    <Stack gap="row">
      <Inline gap="row">
        <Heading level={3}>context</Heading>
        <Text emphasis="muted">{model().summary()}</Text>
      </Inline>
      <Show when={model().msg()}>{(text) => <Alert>{text()}</Alert>}</Show>
    </Stack>
  )
}

export function ContextBody(props: { task: Task; model: ContextModel }) {
  const model = () => props.model

  // Pane intents: context:reveal scrolls to (and expands) a section/item row.
  const applyIntent = (intent: PaneIntent | undefined) => {
    if (intent?.kind === 'context:reveal') model().reveal(intent.sectionId, intent.itemId)
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId === props.task.id && paneId === 'context') applyIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyIntent(consumePaneIntent(props.task.id, 'context')))

  const ItemRow = (rowProps: { section: Section; item: ContextItem }) => {
    const rowId = () => `${rowProps.section.id}:${rowProps.item.id}`
    const open = () => model().isOpen(rowId())
    return (
      <Stack gap="none">
        <Row
          density="compact"
          depth={1}
          label={rowProps.item.label}
          onPress={() => model().toggleOpen(rowId())}
          leading={<Text emphasis="muted">{open() ? '▾' : '▸'}</Text>}
          meta={
            <Inline gap="inline">
              <Show when={originBadge(rowProps.item.origin?.author)}>
                {(badge) => <Badge size="xs">{badge()}</Badge>}
              </Show>
              <Show when={scopePill(rowProps.item.jump?.noteScope)}>
                {(pill) => <Text emphasis="muted">{pill()}</Text>}
              </Show>
            </Inline>
          }
          trailing={
            <Show when={rowProps.item.jump?.pane === 'notes'}>
              <Button variant="bare" size="sm" iconOnly title="Edit in Notes" label="Edit in Notes" onPress={() => model().followJump(rowProps.item)}>✎</Button>
            </Show>
          }
        >
          <Inline gap="inline">
            <Text emphasis="muted">{rowProps.item.kind}</Text>
            <Text>{rowProps.item.label}</Text>
          </Inline>
        </Row>
        <Show when={open()}>
          <Stack gap="row">
            <Show when={rowProps.item.body}>{(body) => <Text emphasis="muted" wrap>{body()}</Text>}</Show>
            <Show when={rowProps.item.details?.length}>
              <Stack gap="none">
                <For each={rowProps.item.details}>{(detail) => <Text emphasis="mono" tone="muted">{detail}</Text>}</For>
              </Stack>
            </Show>
          </Stack>
        </Show>
      </Stack>
    )
  }

  const SectionFold = (foldProps: { section: Section }) => {
    const section = () => foldProps.section
    const ratio = () => model().sectionRatio(section().compact, section().budget)
    const pending = () => model().pendingFor(section().id)
    return (
      <Fold
        label={section().label}
        open={model().sectionOpen(section().id)}
        onOpenChange={(open) => model().setSectionOpen(section().id, open)}
        meta={
          <Inline gap="inline">
            <Show when={pending()}>{(count) => <Text emphasis="muted">· {count()} pending</Text>}</Show>
            <Show when={section().omitted}>{(omitted) => <Text emphasis="muted">+{omitted()} omitted</Text>}</Show>
            <Text emphasis="muted">{formatSize(bytesOf(section().compact))}</Text>
            {/* Meter's `auto` tone carries the 80% warn threshold. */}
            <Show when={ratio() !== null}>
              <Meter tone="auto" label={`${section().label} budget`} value={ratio()!} />
            </Show>
          </Inline>
        }
        actions={
          <Checkbox
            ariaLabel={`Include ${section().label}`}
            checked={model().effective()[section().id] ?? false}
            onChange={() => model().toggleSection(section().id)}
          />
        }
      >
        <Show when={section().absent}>
          {(absent) => <Text emphasis="muted">⚠ {absent().detail}</Text>}
        </Show>
        {/* Extra UI a plugin draws under its own section: memory's add form and proposal queue today,
            anybody's tree tomorrow. `stack`, so context's own rows stay and the contributor's tree
            joins them. The pane asks the host and never learns who answered. */}
        <Slot
          point={CONTEXT_SECTION_POINT}
          key={section().id}
          taskId={props.task.id}
          projectId={props.task.projectId}
          props={() => ({
            task: props.task,
            onChanged: () => void model().refreshContext(),
            onPendingChange: (count: number) => model().reportPending(section().id, count),
          })}
        >
          <Rows
            id={collectionId(section().id)}
            ariaLabel={section().label}
            items={section().items.map((item) => ({ key: item.id, label: item.label, item }))}
          >
            {(entry) => <ItemRow section={section()} item={entry.item} />}
          </Rows>
        </Slot>
      </Fold>
    )
  }

  return (
    <Show when={model().ctx()} fallback={<EmptyState busy>Assembling…</EmptyState>}>
      <Stack gap="none">
        <For each={model().visibleSections()}>{(section) => <SectionFold section={section} />}</For>
      </Stack>
    </Show>
  )
}

export function ContextFooter(props: { task: Task; model: ContextModel }) {
  const model = () => props.model
  return (
    <Stack gap="none">
      <Fold label="preview" persistKey="context.preview" meta={<Text emphasis="muted">{formatSize(bytesOf(model().assembled()?.block ?? ''))}</Text>}>
        <CodeBlock size="xs" maxHeight="block" wrap>{model().assembled()?.block}</CodeBlock>
      </Fold>
      <Toolbar ariaLabel="Context sync">
        <Picker<TerminalSession>
          label={sessionLabel(model().target())}
          placeholder="Filter sessions…"
          emptyText="No running agent session."
          results={(query) => model().sessions(query)}
          rowLabel={(session) => sessionLabel(session)}
          isActive={(session) => session.id === model().target()?.id}
          onSelect={(session) => model().pickTarget(session)}
        />
        <Show when={model().status()}>
          {(status) => (
            <Badge
              tone={status().kind === 'stale' ? 'warn' : 'neutral'}
              shape="pill"
              size="xs"
            >{pillText(status())}</Badge>
          )}
        </Show>
        <Button onPress={() => void model().syncContext()}>Sync context</Button>
        <Toolbar.Spacer />
        <Button variant="bare" iconOnly title="Refresh" label="Refresh" onPress={() => void model().refreshContext()}>↻</Button>
      </Toolbar>
    </Stack>
  )
}
