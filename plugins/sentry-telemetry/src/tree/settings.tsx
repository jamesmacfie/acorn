// Settings → Sentry export: what this plugin sends, once a DSN exists and the core switch is on.
//
// It holds only what core's one switch does not. Whether anything is collected at all belongs to
// Settings → Telemetry, and where it goes belongs to the connection in Settings → Integrations.
// This page is the sink's own three questions: how much, which kinds, and how much detail
// (docs/telemetry.md § The switch).
//
// Every control writes the whole settings object back through `bridge.state`, which is the
// `plugin:sentry-telemetry:settings` preference row the node half reads on each flush. There is no
// save button, because there is nothing here that is only half true between two keystrokes.
import { createResource, createSignal, Show } from 'solid-js'
import { Alert, Checkbox, Field, Heading, Select, Stack, Text } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import {
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_KEY,
  type SentryKindSwitches,
  type SentrySettings,
} from '../shared/settings'

// Fixed steps rather than a number box. A rate is a probability, a typed `0.05` and a typed `5` are
// one keystroke apart, and the difference between them is two orders of magnitude on a bill.
const RATES = [
  { value: '1', label: 'Every trace' },
  { value: '0.5', label: 'Half of traces' },
  { value: '0.25', label: 'A quarter of traces' },
  { value: '0.1', label: 'One trace in ten' },
  { value: '0.01', label: 'One trace in a hundred' },
]

const KINDS: Array<{ id: keyof SentryKindSwitches; label: string; hint: string }> = [
  { id: 'error', label: 'Errors', hint: 'A caught or uncaught failure, as a Sentry issue.' },
  { id: 'span', label: 'Traces', hint: 'Requests, commands, page changes and schedule runs, as transactions.' },
  { id: 'log', label: 'Logs', hint: 'Lines written by core and by plugins, as structured logs.' },
  { id: 'metric', label: 'Metrics', hint: 'Counters, gauges and the hot-seam histograms, as trace metrics.' },
  { id: 'event', label: 'Events', hint: 'Things that happened with no duration, as logs at info.' },
]

/** The nearest offered rate, so a value written by an older build still shows a selected row. */
const rateValue = (rate: number): string =>
  RATES.reduce((best, option) =>
    Math.abs(Number(option.value) - rate) < Math.abs(Number(best.value) - rate) ? option : best,
  RATES[0]).value

export default function SentrySettingsPage(props: { bridge: AcornBridge }) {
  const [loaded] = createResource(() => props.bridge.state.get<unknown>(SETTINGS_KEY))
  // Seeded from the load and then edited in place. The resource is read once: a re-read on every
  // change would put the round trip between the click and the checkbox moving.
  const [edited, setEdited] = createSignal<SentrySettings | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const settings = (): SentrySettings => edited() ?? (loaded.state === 'ready' ? parseSettings(loaded()) : DEFAULT_SETTINGS)

  async function write(next: SentrySettings) {
    setEdited(next)
    setError(null)
    try {
      await props.bridge.state.set(SETTINGS_KEY, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these settings')
    }
  }

  return (
    <Stack gap="section">
      <Stack gap="row">
        <Heading level={3}>Sentry export</Heading>
        <Text tone="muted" wrap>
          Nothing is sent until telemetry is on in Settings → Telemetry and a Sentry DSN is connected
          in Settings → Integrations. Both, not either.
        </Text>
      </Stack>

      <Show when={error()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>

      <Field label="How many traces to send" hint="Decided per trace, so a transaction keeps its own spans.">
        <Select
          options={RATES}
          value={rateValue(settings().sampleRate)}
          onChange={(value: string) => void write({ ...settings(), sampleRate: Number(value) })}
        />
      </Field>

      <Stack gap="row">
        <Text weight="strong">What to send</Text>
        {KINDS.map((kind) => (
          <Checkbox
            label={kind.label}
            hint={kind.hint}
            checked={settings().kinds[kind.id]}
            onChange={(checked: boolean) => void write({ ...settings(), kinds: { ...settings().kinds, [kind.id]: checked } })}
          />
        ))}
      </Stack>

      <Stack gap="row">
        <Text weight="strong">How much detail</Text>
        <Checkbox
          label="Stack traces on errors"
          hint="Paths are collapsed to ~ and to the data root before they leave this machine."
          checked={settings().stacks}
          onChange={(checked: boolean) => void write({ ...settings(), stacks: checked })}
        />
        <Checkbox
          label="Task ids as tags"
          hint="Lets a Sentry issue be traced back to the task it happened in. Ids only, never a task's contents."
          checked={settings().taskIds}
          onChange={(checked: boolean) => void write({ ...settings(), taskIds: checked })}
        />
      </Stack>
    </Stack>
  )
}
