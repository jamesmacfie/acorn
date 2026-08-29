import { For, Show } from 'solid-js'
import {
  Alert, Badge, Button, ChipRow, CodeBlock, DetailColumn, EmptyState, Facts, Heading,
  ListColumn, ListDetail, Row, Stack, TabPanel, Tabs, Text, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type {
  RollbarItemMetadata,
  RollbarOccurrenceDetail,
  RollbarOccurrenceSummary,
} from '../shared/api'
import type { RollbarRailTarget } from '../shared/rail'
import { relativeTime } from './model'

export type RollbarViewState = {
  target: RollbarRailTarget
  item: RollbarItemMetadata
  occurrences: RollbarOccurrenceSummary[]
}

export type OccurrenceState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; detail: RollbarOccurrenceDetail }
  | { kind: 'error'; detail: string }

const occurrenceTitle = (occurrence: RollbarOccurrenceSummary | RollbarOccurrenceDetail): string =>
  occurrence.exceptionClass || occurrence.message || occurrence.kind

const badgeTone = (value: string): 'neutral' | 'ok' | 'danger' | 'warn' => {
  if (/critical|error|failed/i.test(value)) return 'danger'
  if (/warning|active/i.test(value)) return 'warn'
  if (/resolved|enabled/i.test(value)) return 'ok'
  return 'neutral'
}

export function RollbarItemView(props: {
  state: RollbarViewState
  activeTab: string
  occurrence: OccurrenceState
  onSelect(id: string): void
  onRefresh(): void
  onOccurrence(id: string): void
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  const item = () => props.state.item

  return (
    <Stack gap="section">
      {/* Was a header div, an eyebrow div and an h1 with three classes. `Heading` is that shape with a
          name, and the spacing comes from the Stack's role rather than from padding this plugin picked. */}
      <Toolbar variant="bar">
        <Heading level={1} eyebrow={`${item().integrationLabel} · #${item().identifier}`}>{item().title}</Heading>
        <ToolbarSpacer />
        <Button size="sm" onPress={props.onRefresh}>Refresh</Button>
      </Toolbar>

      <ChipRow ariaLabel="Item status">
        <For each={[item().level, item().environment, item().status].filter(Boolean)}>{(value) => (
          <Badge tone={badgeTone(value!)} size="xs">{value}</Badge>
        )}</For>
      </ChipRow>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'occurrences', label: 'Occurrences', count: props.state.occurrences.length },
        ]}
        active={props.activeTab}
        onChange={props.onSelect}
        idPrefix="rollbar"
        ariaLabel="Rollbar item sections"
      />

      <TabPanel idPrefix="rollbar" id="overview" active={props.activeTab}>
        <Facts
          items={[
            { label: 'Occurrences', value: String(item().totalOccurrences), mono: true },
            { label: 'First seen', value: relativeTime(item().firstOccurrenceAt), mono: true },
            { label: 'Last seen', value: relativeTime(item().lastOccurrenceAt), mono: true },
            { label: 'Framework', value: item().framework || 'unknown', mono: true },
            { label: 'Assigned to', value: item().assignedTo || 'unassigned', mono: true },
            { label: 'Resolved in', value: item().resolvedInVersion || '—', mono: true },
          ]}
        />
      </TabPanel>

      <TabPanel idPrefix="rollbar" id="occurrences" active={props.activeTab}>
        <Show
          when={props.state.occurrences.length}
          fallback={<EmptyState>No occurrence sample is available.</EmptyState>}
        >
          <ListDetail split>
            <ListColumn label="Occurrences">
              <For each={props.state.occurrences}>{(entry) => (
                <Row
                  variant="stacked"
                  density="roomy"
                  onPress={() => props.onOccurrence(entry.id)}
                  meta={relativeTime(entry.occurredAt)}
                >
                  <Text>{occurrenceTitle(entry)}</Text>
                  <Text emphasis="mono" tone="muted">
                    {[entry.environment, entry.codeVersion].filter(Boolean).join(' · ')}
                  </Text>
                </Row>
              )}</For>
            </ListColumn>
            <DetailColumn scroll>
              <OccurrenceDetail state={props.occurrence} onCopy={props.onCopy} />
            </DetailColumn>
          </ListDetail>
        </Show>
      </TabPanel>
    </Stack>
  )
}

function OccurrenceDetail(props: {
  state: OccurrenceState
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  return (
    <>
      <Show when={props.state.kind === 'empty'}>
        <EmptyState>Choose an occurrence to inspect its stack.</EmptyState>
      </Show>
      <Show when={props.state.kind === 'loading'}>
        <EmptyState busy>Loading occurrence…</EmptyState>
      </Show>
      <Show when={props.state.kind === 'error'}>
        <Alert variant="banner" title="Could not load the occurrence.">
          {props.state.kind === 'error' ? props.state.detail : ''}
        </Alert>
      </Show>
      <Show when={props.state.kind === 'ready' ? props.state.detail : undefined}>
        {(detail) => <OccurrenceContent detail={detail()} onCopy={props.onCopy} />}
      </Show>
    </>
  )
}

function OccurrenceContent(props: {
  detail: RollbarOccurrenceDetail
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  const detail = () => props.detail
  const facts = () => [
    detail().request?.url
      ? { label: 'Request', value: [detail().request?.method, detail().request?.url].filter(Boolean).join(' '), mono: true }
      : null,
    detail().context ? { label: 'Context', value: detail().context!, mono: true } : null,
    detail().server?.host ? { label: 'Server', value: detail().server!.host!, mono: true } : null,
  ].filter((fact) => fact !== null)

  return (
    <Stack gap="section">
      <Toolbar variant="bar">
        <Stack gap="row">
          <Text emphasis="strong">{occurrenceTitle(detail())}</Text>
          <Text tone="muted">
            {[relativeTime(detail().occurredAt), detail().environment, detail().codeVersion].filter(Boolean).join(' · ')}
          </Text>
        </Stack>
        <ToolbarSpacer />
        <Button size="sm" onPress={() => props.onCopy(detail())}>Copy context</Button>
      </Toolbar>
      <Show when={facts().length}><Facts items={facts()} /></Show>
      {/* The stack, as a location line and a CodeBlock per frame. The left border that marked an
          in-project frame is now the muting of the ones that are not: a border width is a pixel a
          plugin no longer picks, and "this frame is not yours" is the thing it was saying. */}
      <Stack gap="row">
        <For each={detail().frames}>{(frame) => (
          <Stack gap="row">
            <Text emphasis="mono" wrap tone={frame.inProject === false ? 'muted' : 'neutral'}>
              {frame.filename}{frame.line == null ? '' : `:${frame.line}`}{frame.method ? ` · ${frame.method}` : ''}
            </Text>
            <Show when={frame.code.length}>
              <CodeBlock size="xs" maxHeight="block">
                {frame.code.map((line) => `${String(line.line).padStart(4)}  ${line.text}`).join('\n')}
              </CodeBlock>
            </Show>
          </Stack>
        )}</For>
      </Stack>
    </Stack>
  )
}
