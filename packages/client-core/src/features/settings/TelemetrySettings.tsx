import { For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, telemetrySummaryOptions } from '../../infra/queries'
import { formatRelativeTime } from '../../kit/lib/formatRelativeTime'
import { Checkbox, Field } from '../../kit/components/primitives'
import { saveTelemetryOn, telemetryOn } from './telemetrySetting'
import './settings.css'

// Settings → Telemetry: the one switch, and an honest account of what it turns on
// (docs/telemetry.md § The switch).
//
// One control on a page of its own rather than a row buried under Appearance, because this is the
// page a person opens to answer "what is this app sending". The page says what collection is for and
// what it refuses, so the answer is here rather than in a changelog.
//
// The switch alone collects nothing. A record is only built when a plugin has subscribed as a sink,
// which needs a permission the trust prompt draws high (docs/security.md § Telemetry sinks), so
// leaving this on with no exporter installed costs one boolean read at each seam.
//
// Under the switch is the evidence: what the node has actually collected since it started, per
// owner and kind, and which plugins are reading it. Counters from the collector rather than a
// window over its ring, because the ring is 5,000 records deep and a sink may have drained it a
// second ago (docs/telemetry.md § What the page shows). They move while the page is open, which is
// what makes the switch legible: turn it on, run a command, watch a number change.

/** How many owner-and-kind rows to draw before folding the rest into a line. Long enough for core
 *  plus a handful of plugins across the five kinds, short enough that the page stays a page. */
const ROWS_SHOWN = 12

export default function TelemetrySettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const on = () => telemetryOn(prefs.data)
  const summary = createQuery(() => telemetrySummaryOptions(true))
  const rows = () => summary.data?.records ?? []
  const total = () => rows().reduce((sum, row) => sum + row.count, 0)

  return (
    <>
      <Field
        label="Collection"
        hint="Off unless you turn it on. The node re-reads this within five seconds, and every window and terminal paired with it follows."
        group
      >
        <Checkbox
          label="Collect timings, logs and errors on this node"
          checked={on()}
          onChange={(next) => void saveTelemetryOn(qc, next)}
        />
      </Field>

      <Field
        label="What this node has collected"
        hint="Since the node started. Counts, never the records themselves."
        group
      >
        <Show when={summary.data} fallback={<p class="muted">Asking the node.</p>}>
          {(data) => (
            <>
              <p class="muted">
                <Show when={data().collecting} fallback={<>Nothing is being collected. {data().enabled ? 'The switch is on, and no plugin has asked to read the stream.' : 'The switch is off.'}</>}>
                  Collecting. This node started {formatRelativeTime(data().since)} and has built {total().toLocaleString()} record{total() === 1 ? '' : 's'} so far.
                </Show>
              </p>
              <Show when={rows().length > 0}>
                <div class="telemetry-counts">
                  <For each={rows().slice(0, ROWS_SHOWN)}>
                    {(row) => (
                      <div class="telemetry-count-row">
                        <span class="telemetry-owner">{row.owner}</span>
                        <span class="muted">{row.kind}</span>
                        <span class="telemetry-number">{row.count.toLocaleString()}</span>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={rows().length > ROWS_SHOWN}>
                  <p class="muted">and {rows().length - ROWS_SHOWN} more owner and kind pairs.</p>
                </Show>
              </Show>
              <p class="muted">
                Read by: {data().sinks.length ? data().sinks.join(', ') : 'nobody'}.
                <Show when={data().lastFlushAt}>{(at) => <> Last handed over {formatRelativeTime(at())}.</>}</Show>
                <Show when={data().dropped > 0}>{' '}{data().dropped.toLocaleString()} records were dropped because nothing read them in time.</Show>
              </p>
            </>
          )}
        </Show>
      </Field>

      <Field label="What a record can hold" group>
        <p class="muted">
          A record carries a name, a duration, and a short list of scalar attributes: which route, which
          plugin, which pane, and whether it worked. Prompts, agent output, file contents, diffs,
          terminal bytes, request bodies and query text are never included, and absolute paths are cut
          back to your home directory and the data root before a record is kept.
        </p>
      </Field>

      <Field label="Where it goes" group>
        <p class="muted">
          Nowhere on its own. Records are held on the node and handed to whichever plugin you have given
          the telemetry permission to. With no such plugin installed, nothing is collected and nothing
          leaves this machine.
        </p>
      </Field>
    </>
  )
}
