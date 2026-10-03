import { For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { nodePrefsOptions, telemetrySummaryOptions } from '../../infra/queries'
import { formatRelativeTime } from '../../kit/lib/rendering/formatRelativeTime'
import { Checkbox, EmptyState, Table, TableCell, TableHead, TableRow } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { Stack } from '../../kit/components/layout/Stack'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave } from './settingSave'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { saveTelemetryOn, telemetryOn } from './telemetrySetting'
import './settings.css'

// Settings → Telemetry: the one switch, and an honest account of what it turns on
// (docs/telemetry/model.md § The switch). Per node, following the settings header's node switcher.
//
// One control on a page of its own rather than a row buried under Appearance, because this is the
// page a person opens to answer "what is this app sending". The page says what collection is for and
// what it refuses, so the answer is here rather than in a changelog.
//
// The switch alone collects nothing. A record is only built when a plugin has subscribed as a sink,
// which needs a permission the trust prompt draws high (docs/security/plugin-node-realm.md § Telemetry sinks), so
// leaving this on with no exporter installed costs one boolean read at each seam.
//
// Under the switch is the evidence: what the node has actually collected since it started, per
// owner and kind, and which plugins are reading it. Counters from the collector rather than a
// window over its ring, because the ring is 5,000 records deep and a sink may have drained it a
// second ago (docs/telemetry/diagnosis.md § What the page shows). They move while the page is open, which is
// what makes the switch legible: turn it on, run a command, watch a number change.

/** How many owner-and-kind rows to draw before folding the rest into a line. Long enough for core
 *  plus a handful of plugins across the five kinds, short enough that the page stays a page. */
const ROWS_SHOWN = 12

export default function TelemetrySettings(props: { nodeId: string | null }) {
  const qc = useQueryClient()
  // The named node's own rows, whichever node the settings header points at. The switch is a node
  // preference, so there is no device value to merge in.
  const prefs = createQuery(() => nodePrefsOptions(props.nodeId))
  const on = () => telemetryOn(prefs.data)
  const summary = createQuery(() => telemetrySummaryOptions(true, props.nodeId))
  const rows = () => summary.data?.records ?? []
  const total = () => rows().reduce((sum, row) => sum + row.count, 0)
  const save = createSettingSave()

  return (
    <>
      <SettingsSection
        id="collection"
        label="Collection"
        help="Nothing leaves this node unless you give a plugin permission to receive it. This setting reaches every window and terminal connected to the node within a few seconds."
      >
        <SettingRow
          label="Collect timings, logs, and errors on this node"
          // Until the node answers, the switch would show Off as a guess and a click would write it.
          error={save.error() ?? (prefs.isError ? "Couldn't load this setting." : undefined)}
        >
          <Checkbox
            switch
            ariaLabel="Collect timings, logs, and errors on this node"
            checked={on()}
            disabled={!prefs.isSuccess}
            onChange={(next) => save.run(() => saveTelemetryOn(qc, next, props.nodeId))}
          />
        </SettingRow>
      </SettingsSection>

      {/* What a record may hold is said here, beside the evidence, rather than in a section of its own:
          the two answer one question (docs/telemetry/model.md § What never leaves the machine). */}
      <SettingsSection id="collected" label="What this node has collected" description="Counts since the node started. The records themselves aren't shown.">
        <Stack gap="row">
          <Show
            when={summary.data}
            fallback={summary.isError
              ? <Text tone="danger" wrap>Couldn't reach the node.</Text>
              : <EmptyState busy align="start" size="sm">Loading…</EmptyState>}
          >
            {(data) => (
              <>
                <Text emphasis="muted" wrap>
                  <Show when={data().collecting} fallback={<>Not collecting. {data().enabled ? 'No plugin is set up to receive it.' : 'Collection is off.'}</>}>
                    Collecting. {total().toLocaleString()} record{total() === 1 ? '' : 's'} since the node started {formatRelativeTime(data().since)}.
                  </Show>
                </Text>
                <Show when={rows().length > 0}>
                  <Table size="sm">
                    <TableRow head>
                      <TableHead>Owner</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead align="end">Count</TableHead>
                    </TableRow>
                    <For each={rows().slice(0, ROWS_SHOWN)}>
                      {(row) => (
                        <TableRow>
                          <TableCell header>{row.owner === 'core' ? 'acorn' : pluginLabel(row.owner)}</TableCell>
                          <TableCell>{row.kind}</TableCell>
                          <TableCell align="end">{row.count.toLocaleString()}</TableCell>
                        </TableRow>
                      )}
                    </For>
                  </Table>
                  <Show when={rows().length > ROWS_SHOWN}>
                    <Text emphasis="muted">And {rows().length - ROWS_SHOWN} more.</Text>
                  </Show>
                </Show>
                <Text emphasis="muted" wrap>
                  Sent to {data().sinks.length ? data().sinks.map((id) => pluginLabel(id)).join(', ') : 'nothing'}.
                  <Show when={data().lastFlushAt}>{(at) => <> Last sent {formatRelativeTime(at())}.</>}</Show>
                  <Show when={data().dropped > 0}>{' '}{data().dropped.toLocaleString()} records were dropped because nothing received them in time.</Show>
                </Text>
              </>
            )}
          </Show>
          <Text emphasis="muted" wrap>
            A record holds a name, a time, and a few labels, such as which plugin or pane and whether it
            worked. It never holds prompts, agent output, file contents, diffs, terminal output, request
            bodies, or query text. Paths are shortened to your home folder and the data folder.
          </Text>
        </Stack>
      </SettingsSection>
    </>
  )
}
