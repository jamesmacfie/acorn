// Settings → Sentry export: what this plugin sends, once a DSN exists and the core switch is on.
//
// It holds only what core's one switch does not. Whether anything is collected at all belongs to
// Settings → Telemetry, and where it goes belongs to the connection in Settings → Services.
// This page is the sink's own three questions: how much, which kinds, and how much detail
// (docs/telemetry/model.md § The switch).
//
// Every control writes the whole settings object back through `bridge.state`, which is the
// `plugin:sentry-telemetry:settings` preference row the node half reads on each flush. There is no
// save button, because there is nothing here that is only half true between two keystrokes.
import { createResource, createSignal } from 'solid-js'
import { Checkbox, Select, SettingRow, SettingsSection } from '@acorn/plugin-api/ui/tree'
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
  { id: 'error', label: 'Errors', hint: 'Sent as Sentry issues.' },
  { id: 'span', label: 'Traces', hint: 'Requests, commands, page changes, and schedule runs.' },
  { id: 'log', label: 'Logs', hint: 'Log lines from acorn and its plugins.' },
  { id: 'metric', label: 'Metrics', hint: 'Counts and timings from acorn.' },
  { id: 'event', label: 'Events', hint: 'One-off events, sent as info logs.' },
]

/** The nearest offered rate, so a value written by an older build still shows a selected row. */
const rateValue = (rate: number): string =>
  RATES.reduce((best, option) =>
    Math.abs(Number(option.value) - rate) < Math.abs(Number(best.value) - rate) ? option : best,
  RATES[0]).value

/** Which row a write came from, so its error is drawn beside that row and nowhere else. */
type RowId = 'rate' | keyof SentryKindSwitches | 'stacks' | 'taskIds'

export default function SentrySettingsPage(props: { bridge: AcornBridge }) {
  const [loaded] = createResource(() => props.bridge.state.get<unknown>(SETTINGS_KEY))
  // Seeded from the load and then edited in place. The resource is read once: a re-read on every
  // change would put the round trip between the click and the checkbox moving.
  const [edited, setEdited] = createSignal<SentrySettings | null>(null)
  const [failure, setFailure] = createSignal<{ row: RowId; message: string } | null>(null)
  const settings = (): SentrySettings => edited() ?? (loaded.state === 'ready' ? parseSettings(loaded()) : DEFAULT_SETTINGS)
  const errorOn = (row: RowId) => {
    const failed = failure()
    return failed?.row === row ? failed.message : undefined
  }

  // Every control here is a switch or a select, so it shows its own state. A failed write puts the
  // previous value back, which leaves the control saying what is stored, and names the failure on
  // the row it came from.
  async function write(row: RowId, next: SentrySettings) {
    const previous = settings()
    setEdited(next)
    setFailure(null)
    try {
      await props.bridge.state.set(SETTINGS_KEY, next)
    } catch (err) {
      setEdited(previous)
      setFailure({ row, message: err instanceof Error ? err.message : 'Could not save these settings' })
    }
  }

  // The host's header already names the page, so the tree starts at its first section.
  return (
    <>
      <SettingsSection
        id="sending"
        label="What to send"
        description="acorn sends nothing until you turn on Telemetry and connect Sentry in Services."
      >
        <SettingRow label="How many traces to send" error={errorOn('rate')}>
          <Select
            label="How many traces to send"
            options={RATES}
            value={rateValue(settings().sampleRate)}
            onChange={(value: string) => void write('rate', { ...settings(), sampleRate: Number(value) })}
          />
        </SettingRow>
        {KINDS.map((kind) => (
          <SettingRow label={kind.label} description={kind.hint} error={errorOn(kind.id)}>
            <Checkbox
              switch
              ariaLabel={kind.label}
              checked={settings().kinds[kind.id]}
              onChange={(checked: boolean) => void write(kind.id, { ...settings(), kinds: { ...settings().kinds, [kind.id]: checked } })}
            />
          </SettingRow>
        ))}
      </SettingsSection>

      <SettingsSection id="detail" label="How much detail">
        <SettingRow
          label="Stack traces on errors"
          description="acorn replaces your home folder with ~ in file paths before sending them."
          error={errorOn('stacks')}
        >
          <Checkbox
            switch
            ariaLabel="Stack traces on errors"
            checked={settings().stacks}
            onChange={(checked: boolean) => void write('stacks', { ...settings(), stacks: checked })}
          />
        </SettingRow>
        <SettingRow
          label="Task ids as tags"
          description="Links a Sentry issue to its task. Only the id is sent, never the task's contents."
          error={errorOn('taskIds')}
        >
          <Checkbox
            switch
            ariaLabel="Task ids as tags"
            checked={settings().taskIds}
            onChange={(checked: boolean) => void write('taskIds', { ...settings(), taskIds: checked })}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
}
