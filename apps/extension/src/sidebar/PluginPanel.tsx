import { For, Index, Match, Show, Switch, createSignal } from 'solid-js'
import type { BridgePanel } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserPanelBlock, BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Heading, Log, Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import CopyButton from '@acorn/client-core/kit/components/inputs/CopyButton.tsx'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Inline, Section, Stack, type TabDef } from '@acorn/client-core/kit/components/layout'
import { Badge, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { taskPaneLink } from '../acornLinks'
import { OpenInAcorn } from './OpenInAcorn'

type StatusBlock = Extract<BrowserPanelBlock, { kind: 'status' }>

// A panel has no "ok": a plugin sends `info` for a passing check or an approving review.
const SEVERITY = {
  info: { icon: 'circle-check', tone: 'ok', badge: 'ok' },
  warn: { icon: 'circle-alert', tone: 'warn', badge: 'warn' },
  danger: { icon: 'circle-x', tone: 'danger', badge: 'danger' },
  pending: { icon: 'circle-dashed', tone: 'muted', badge: 'neutral' },
} as const

const SeverityIcon = (props: { severity: StatusBlock['severity'] }) => (
  <Icon name={SEVERITY[props.severity].icon} tone={SEVERITY[props.severity].tone} />
)

// The view's first block heads the panel when it's a status block.
const headerOf = (view: BrowserPanelView | null | undefined): StatusBlock | undefined => {
  const first = view?.blocks[0]
  return first?.kind === 'status' ? first : undefined
}

// The panel's tab marker: the header's icon, while the header says something is wrong.
export const panelMarker = (view: BrowserPanelView | null | undefined): TabDef['marker'] =>
  headerOf(view)?.severity === 'danger' ? { ...SEVERITY.danger, label: 'Needs attention' } : undefined

// Only a web address that answers opens in a tab. Anything else, such as a database address, is copied.
const opens = (link: { url: string; ready?: boolean }) =>
  link.ready !== false && (link.url.startsWith('https://') || link.url.startsWith('http://'))

// A plugin's read-only view of one task, drawn with the kit's parts from the fixed blocks its route
// answered with, as text. Changing anything happens in the plugin's pane in Acorn. `view` is undefined
// while the first read is out, and null when the plugin has no panel for the task, which closes the
// panel. A failed read keeps the last view and says why above it. docs/browser-extension/plugin-panels.md.
export function PluginPanel(props: {
  panel: BridgePanel
  nodeId: string
  taskId: string
  view: BrowserPanelView | null | undefined
  problem: string | null
  opensLinks: boolean
  refresh(): Promise<void>
  pickSource(source: string): Promise<void>
}) {
  // Refresh turns while a read the person started is out.
  const [reads, setReads] = createSignal(0)
  const read = (started: Promise<void>) => {
    setReads((count) => count + 1)
    void started.finally(() => setReads((count) => count - 1))
  }
  const header = () => headerOf(props.view)
  const blocks = () => props.view?.blocks.slice(header() ? 1 : 0) ?? []

  return (
    <div class="view plugin-panel" aria-label={props.panel.label}>
      <div class="panel-head">
        <Show when={header()} fallback={<span />}>
          {(status) => <PanelHeader status={status()} />}
        </Show>
        <Inline gap="none">
          <IconButton
            icon="refresh-cw"
            label="Refresh"
            spin={reads() > 0 || props.view === undefined}
            onPress={() => read(props.refresh())}
          />
          <OpenInAcorn
            href={taskPaneLink(props.nodeId, props.taskId, props.panel.pane)}
            opensLinks={props.opensLinks}
            iconOnly
          />
        </Inline>
      </div>
      <Show when={props.problem}>
        {(message) => (
          <p class="empty problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <div class="panel-blocks">
        <For each={blocks()}>{(block) => <Block block={block} pickSource={(id) => read(props.pickSource(id))} />}</For>
      </div>
      <Show when={props.view === undefined && !props.problem}>
        <p class="empty quiet">Loading…</p>
      </Show>
    </div>
  )
}

// The label, the state as a badge, then the detail's lines: the first in bold, as the panel's subtitle,
// and the rest muted. docs/plugin-authoring/browser-panel.md states the rule for plugin authors.
function PanelHeader(props: { status: StatusBlock }) {
  const lines = () => props.status.detail?.split('\n').filter(Boolean) ?? []
  return (
    <Stack gap="inline">
      <Inline>
        <Heading level={2}>{props.status.label}</Heading>
        <Badge tone={SEVERITY[props.status.severity].badge}>{props.status.state}</Badge>
      </Inline>
      <Index each={lines()}>
        {(line, index) => (
          <Text wrap emphasis={index === 0 ? 'strong' : 'muted'} tone={index === 0 ? undefined : 'muted'}>
            {line()}
          </Text>
        )}
      </Index>
    </Stack>
  )
}

function Block(props: { block: BrowserPanelBlock; pickSource(source: string): void }) {
  return (
    <Switch>
      <Match when={props.block.kind === 'status' && props.block}>
        {(block) => (
          <Row
            density="compact"
            tip={block().detail}
            leading={<SeverityIcon severity={block().severity} />}
            meta={block().state}
          >
            {block().label}
          </Row>
        )}
      </Match>
      <Match when={props.block.kind === 'links' && props.block}>
        {(block) => (
          <Section label={block().title} count={block().links.length}>
            <For each={block().links}>
              {(link) => (
                <Row
                  variant="stacked"
                  density="compact"
                  href={opens(link) ? link.url : undefined}
                  leading={<Icon name="link" tone="muted" />}
                  trailing={
                    <>
                      <CopyButton text={link.url} always />
                      <Show when={opens(link)}>
                        <Icon name="arrow-up-right" tone="muted" />
                      </Show>
                    </>
                  }
                >
                  <Text>{link.label}</Text>
                  <Text emphasis="muted">{link.url.replace(/^https?:\/\//, '')}</Text>
                </Row>
              )}
            </For>
          </Section>
        )}
      </Match>
      <Match when={props.block.kind === 'rows' && props.block}>
        {(block) => (
          <Section label={block().title} count={block().rows.length}>
            <For each={block().rows}>
              {(row) => (
                <Row density="compact" leading={<SeverityIcon severity={row.severity} />} meta={row.state}>
                  {row.label}
                </Row>
              )}
            </For>
          </Section>
        )}
      </Match>
      <Match when={props.block.kind === 'logs' && props.block}>
        {(block) => (
          <Section
            label={block().title}
            actions={
              <Show when={block().sources.length}>
                <Picker
                  label={block().sources.find((source) => source.id === block().source)?.label ?? 'Source'}
                  ariaLabel="Log source"
                  size="sm"
                  variant="ghost"
                  placement="bottom-end"
                  placeholder="Filter sources"
                  emptyText="No source matches."
                  items={block().sources.map((source) => ({
                    id: source.id,
                    label: source.label,
                    active: source.id === block().source,
                  }))}
                  onPick={props.pickSource}
                />
              </Show>
            }
          >
            <Show when={block().lines.length} fallback={<p class="empty quiet">No log lines.</p>}>
              <Log lines={block().lines} follow ariaLabel={block().title} />
            </Show>
          </Section>
        )}
      </Match>
    </Switch>
  )
}
