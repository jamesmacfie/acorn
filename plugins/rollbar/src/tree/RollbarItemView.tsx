import { For, Show } from 'solid-js'
import {
  Alert, Badge, Button, ChipRow, CodeBlock, DetailColumn, EmptyState, Facts, Heading, IconButton,
  ListColumn, ListDetail, Row, Section, Stack, TabPanel, Tabs, Text, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type {
  RollbarItemMetadata,
  RollbarOccurrenceDetail,
  RollbarOccurrenceSummary,
} from '../shared/api'
import type { RollbarRailTarget } from '../shared/rail'
import { levelWord, relativeTime, statusWord } from './model'

export type RollbarViewState = {
  target: RollbarRailTarget
  item: RollbarItemMetadata
  occurrences: RollbarOccurrenceSummary[]
}

export type OccurrenceState =
  | { kind: 'empty' }
  | { kind: 'loading'; id: string }
  | { kind: 'ready'; detail: RollbarOccurrenceDetail }
  | { kind: 'error'; id: string; detail: string }

const chosenId = (state: OccurrenceState): string | undefined =>
  state.kind === 'ready' ? state.detail.id : state.kind === 'empty' ? undefined : state.id

// "TypeError: Cannot read…", the class and the message together, because the class alone is the same
// on every occurrence of an error.
const occurrenceTitle = (occurrence: RollbarOccurrenceDetail): string =>
  [occurrence.exceptionClass, occurrence.message].filter(Boolean).join(': ') || occurrence.kind

export function RollbarItemView(props: {
  state: RollbarViewState
  activeTab: string
  occurrence: OccurrenceState
  latest: OccurrenceState
  refreshing: boolean
  refreshError: string
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
        <Heading level={2} eyebrow={`${item().integrationLabel} · #${item().identifier}`}>{item().title}</Heading>
        <ToolbarSpacer />
        <IconButton icon="refresh-cw" label="Refresh error" busy={props.refreshing} disabled={props.refreshing} onPress={props.onRefresh} />
      </Toolbar>

      <Show when={props.refreshError}>{(detail) => (
        <Alert variant="banner" title="Couldn't refresh this error. Showing the last data we got.">{detail()}</Alert>
      )}</Show>

      {/* Level and status as words from a map; the environment stays as the project spelled it. */}
      <ChipRow ariaLabel="Error status">
        <Show when={item().level}>{(level) => <Badge tone={levelWord(level()).tone} size="xs">{levelWord(level()).label}</Badge>}</Show>
        <Show when={item().environment}>{(environment) => <Badge size="xs">{environment()}</Badge>}</Show>
        <Show when={item().status}>{(status) => <Badge tone={statusWord(status()).tone} size="xs">{statusWord(status()).label}</Badge>}</Show>
      </ChipRow>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'occurrences', label: 'Occurrences', count: props.state.occurrences.length },
        ]}
        active={props.activeTab}
        onChange={props.onSelect}
        idPrefix="rollbar"
        ariaLabel="Error sections"
      />

      {/* Mono only for a version, the one value here that is code. */}
      <TabPanel idPrefix="rollbar" id="overview" active={props.activeTab}>
        <Stack gap="section">
          <Facts
            items={[
              { label: 'Occurrences', value: item().totalOccurrences.toLocaleString() },
              { label: 'First seen', value: relativeTime(item().firstOccurrenceAt) },
              { label: 'Last seen', value: relativeTime(item().lastOccurrenceAt) },
              { label: 'Framework', value: item().framework || 'Not reported' },
              { label: 'Assigned to', value: item().assignedTo || 'No one' },
              { label: 'Resolved in', value: item().resolvedInVersion || 'Not resolved', mono: !!item().resolvedInVersion },
            ]}
          />
          <Show when={props.state.occurrences.length} fallback={(
            <Text tone="muted">Rollbar has no recent occurrences for this error.</Text>
          )}>
            <Section label="Newest occurrence">
              <Show when={props.latest.kind === 'ready' ? props.latest.detail : undefined} fallback={(
                <Show
                  when={props.latest.kind === 'error' ? props.latest.detail : undefined}
                  fallback={<EmptyState busy align="start" size="sm">Loading occurrence…</EmptyState>}
                >
                  {(reason) => <Alert variant="banner" title="Couldn't load this occurrence.">{reason()}</Alert>}
                </Show>
              )}>
                {(detail) => (
                  <Stack gap="row">
                    <Text wrap>{occurrenceTitle(detail())}</Text>
                    <Trace detail={detail()} />
                  </Stack>
                )}
              </Show>
            </Section>
          </Show>
        </Stack>
      </TabPanel>

      <TabPanel idPrefix="rollbar" id="occurrences" active={props.activeTab}>
        <Show
          when={props.state.occurrences.length}
          fallback={<EmptyState align="start" size="sm">Rollbar has no recent occurrences for this error.</EmptyState>}
        >
          <ListDetail split>
            {/* Every occurrence of one error has the same class, so a row is told apart by when it
                happened and where. */}
            <ListColumn label="Occurrences">
              <For each={props.state.occurrences}>{(entry) => (
                <Row
                  onPress={() => props.onOccurrence(entry.id)}
                  selected={chosenId(props.occurrence) === entry.id}
                  meta={[entry.environment, entry.codeVersion].filter(Boolean).join(' · ')}
                >
                  {relativeTime(entry.occurredAt)}
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
        <EmptyState title="Choose an occurrence">Its stack trace shows here.</EmptyState>
      </Show>
      <Show when={props.state.kind === 'loading'}>
        <EmptyState busy align="start" size="sm">Loading occurrence…</EmptyState>
      </Show>
      <Show when={props.state.kind === 'error'}>
        <Alert variant="banner" title="Couldn't load this occurrence.">
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
  // The request spans the row, so a long URL has the width before it has to wrap. Mono only for the
  // host, the one value here that is a machine's name.
  const facts = () => [
    detail().request?.url
      ? { label: 'Request', value: [detail().request?.method, detail().request?.url].filter(Boolean).join(' '), wide: true }
      : null,
    detail().context ? { label: 'Context', value: detail().context! } : null,
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
        <Button
          size="sm"
          title="Copies the error, stack, and request as text for an agent or a ticket."
          onPress={() => props.onCopy(detail())}
        >
          Copy details
        </Button>
      </Toolbar>
      <Show when={facts().length}><Facts items={facts()} /></Show>
      <Trace detail={detail()} />
    </Stack>
  )
}

/** The stack, shared by Overview's newest occurrence and the occurrence detail. */
function Trace(props: { detail: RollbarOccurrenceDetail }) {
  return (
    <Stack gap="row">
      {/* A location line and a CodeBlock per frame. The left border that marked an in-project frame
          is now the muting of the ones that are not: a border width is a pixel a plugin no longer
          picks, and "this frame is not yours" is the thing it was saying. "›" marks the line that
          threw. */}
      <For each={props.detail.frames}>{(frame) => (
        <Stack gap="row">
          <Text emphasis="mono" wrap tone={frame.inProject === false ? 'muted' : 'neutral'}>
            {frame.filename}{frame.line == null ? '' : `:${frame.line}`}{frame.method ? ` · ${frame.method}` : ''}
          </Text>
          <Show when={frame.code.length}>
            <CodeBlock size="xs" maxHeight="block">
              {frame.code.map((line) => `${line.line === frame.line ? '›' : ' '} ${String(line.line).padStart(4)}  ${line.text}`).join('\n')}
            </CodeBlock>
          </Show>
        </Stack>
      )}</For>
    </Stack>
  )
}
