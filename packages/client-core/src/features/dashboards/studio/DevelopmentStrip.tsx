import { For, Show } from 'solid-js'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { Badge, Button, EmptyState, Table, TableCell, TableHead, TableRow, Toolbar } from '../../../kit/components/primitives'
import { Heading } from '../../../kit/components/content/Heading'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'

// What the studio shows while a panel reads a source whose plugin is in development mode
// (docs/data-sources/derived-sources.md § Develop one against real data): a strip under the toolbar
// with what the last run read and dropped, and the table of dropped records that Show records swaps
// in for the preview. The Node adds the numbers to the run only in development mode.

/** A plugin in development mode that this panel reads, as the node's roster reports it. */
export type DevelopingPlugin = { id: string; reloadedAt?: number; failure?: string }
type SourceDiagnostic = DashboardRun['diagnostics']['sources'][number]

const ms = (value: number): string => `${Math.round(value)} ms`
const records = (count: number): string => `${count} ${count === 1 ? 'record' : 'records'}`

/** How many records each source dropped for not matching its declared fields. */
export const droppedCount = (sources: readonly SourceDiagnostic[]): number => sources.reduce((sum, source) =>
  sum + (source.completeness?.kind === 'incomplete' && source.completeness.cause === 'invalid-records' ? source.completeness.count ?? 0 : 0), 0)

/** "pulls read 42 records in 120 ms · the run took 230 ms", for one source's development run. */
function readLine(source: SourceDiagnostic): string {
  const development = source.development!
  const reads = Object.entries(development.inputMs)
    .map(([input, time]) => `${input} read ${records(source.inputs?.[input]?.records ?? 0)} in ${ms(time)}`)
  const total = development.pluginMs + Object.values(development.inputMs).reduce((sum, time) => sum + time, 0)
  return [...reads, `the run took ${ms(total)}`].join(' · ')
}

export default function DevelopmentStrip(props: {
  plugins: DevelopingPlugin[]
  /** The last run's sources that carry development numbers. */
  sources: SourceDiagnostic[]
  showingRecords: boolean
  reloading: boolean
  onShowRecords: () => void
  onReload: (pluginId: string) => void
  onLogs: (pluginId: string) => void
}) {
  const dropped = () => droppedCount(props.sources)
  return (
    <For each={props.plugins}>{plugin => (
      <Toolbar size="sm" ariaLabel={`${plugin.id} in development`}>
        <Inline gap="inline" wrap>
          <Text emphasis="strong">{plugin.id}</Text>
          <Show when={plugin.reloadedAt}>{at => <Text emphasis="muted">{`reloaded ${formatRelativeTime(at())}`}</Text>}</Show>
          <Show when={plugin.failure}>{reason => <Badge tone="warn">{`Reload failed: ${reason()}`}</Badge>}</Show>
          <For each={props.sources}>{source => <Text emphasis="muted">{readLine(source)}</Text>}</For>
          <Show when={dropped()}>{count => <Badge tone="warn">{`${records(count())} didn't match the declared fields`}</Badge>}</Show>
        </Inline>
        <Inline gap="inline">
          <Button size="xs" variant="ghost" pressed={props.showingRecords} disabled={!dropped() && !props.showingRecords} onPress={props.onShowRecords}>
            Show records
          </Button>
          <Button size="xs" variant="ghost" busy={props.reloading} onPress={() => props.onReload(plugin.id)}>Reload plugin</Button>
          <Button size="xs" variant="ghost" onPress={() => props.onLogs(plugin.id)}>Logs</Button>
        </Inline>
      </Toolbar>
    )}</For>
  )
}

/** The records the last run dropped: up to 20 per source, with the field at fault and what was wrong. */
export function DroppedRecords(props: { sources: SourceDiagnostic[]; onClose: () => void }) {
  const rows = () => props.sources.flatMap(source => source.development!.dropped.map(record => ({ ...record, source: source.label })))
  return (
    <div class="dash-studio-preview">
      <Inline gap="inline">
        <Heading level={3}>Records that didn't match</Heading>
        <Button size="xs" variant="ghost" onPress={props.onClose}>Back to the preview</Button>
      </Inline>
      <Show when={rows().length} fallback={<EmptyState align="start" size="sm" title="Every record matched">The last run dropped nothing.</EmptyState>}>
        <Text emphasis="muted" wrap>{`The first ${records(rows().length)} of ${records(droppedCount(props.sources))} dropped. Each is left out of the panel.`}</Text>
        <Table size="sm">
          <TableRow head>
            <TableHead>Record</TableHead>
            <Show when={props.sources.length > 1}><TableHead>Source</TableHead></Show>
            <TableHead>Field</TableHead>
            <TableHead>Problem</TableHead>
          </TableRow>
          <For each={rows()}>{row => (
            <TableRow>
              <TableCell header>{row.recordId}</TableCell>
              <Show when={props.sources.length > 1}><TableCell>{row.source}</TableCell></Show>
              <TableCell>{row.pointer || 'The whole record'}</TableCell>
              <TableCell>{row.message}</TableCell>
            </TableRow>
          )}</For>
        </Table>
      </Show>
    </div>
  )
}
