/** @jsxImportSource @acorn/tui/jsx */
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence'
import { createSettingSave, type SettingSave } from '@acorn/client-core/features/settings'
import { parseNotificationSettings, saveNotificationEvent, type NotificationSettings } from '@acorn/client-core/features/notifications'
import { defaultDeliveryContext, deliverNotice } from '@acorn/client-core/features/notifications/deliver.ts'
import { activeTaskId } from '@acorn/client-core/features/tasks/tasks.ts'
import { Line } from '../kit/cells'
import { Button, Checkbox } from '../kit/asking'
import { SettingRow, SettingsSection } from '../kit/grouping'
import { detectBackend, notifyMode, type NotifyMode } from '../kit/notify'

// Settings → Notifications on this host: the terminal's own alert row, then the rows of the desktop's
// page that this host honours (client-core/features/settings/NotificationSettings.tsx).
//
// The desktop's three channel switches are absent. Here the channels are the bell and the terminal's
// own notification sequence, and `ACORN_TUI_NOTIFY` is what chooses between them (../kit/notify.ts).
// The desktop's sound switch does not reach the bell, the app icon count is this host's topbar count and
// is always on, and a second switch for the terminal notification would be two controls for one
// channel. The event switches are the gate's own, read and written through the same accessor as the
// desktop's page and the palette's setting commands, and this host's gate reads them.

const MODE_LABEL: Record<NotifyMode, string> = {
  both: 'Bell and terminal notification',
  bell: 'Bell only',
  terminal: 'Terminal notification only',
  off: 'Off',
}

/** What the row says about where the value comes from. The environment is the only place it can be
 *  set: acorn reads it once at startup, and there is no preference behind it to write. */
function alertSource(env: NodeJS.ProcessEnv): string {
  const raw = env.ACORN_TUI_NOTIFY
  const change = 'Set ACORN_TUI_NOTIFY to off, bell, terminal, or both, then restart acorn.'
  if (raw === undefined || raw === '') return `The default. ${change}`
  if (notifyMode(env) === 'both' && raw !== 'both') return `ACORN_TUI_NOTIFY is "${raw}", which acorn does not recognise, so it uses the default. ${change}`
  return `From ACORN_TUI_NOTIFY. ${change}`
}

/** The one thing the mode cannot say by itself: a terminal that takes no notification sequence acorn
 *  knows gets the bell and nothing else, whatever the mode asks for. */
function backendNote(env: NodeJS.ProcessEnv): string | undefined {
  const mode = notifyMode(env)
  if ((mode !== 'terminal' && mode !== 'both') || detectBackend(env)) return undefined
  return mode === 'both'
    ? 'This terminal takes no notification sequence acorn knows, so only the bell reaches you.'
    : 'This terminal takes no notification sequence acorn knows, so no alert reaches you.'
}

export default function TerminalNotifications() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const settings = () => parseNotificationSettings(prefs.data?.[PrefKeys.notifications])
  const saveEvent = (row: SettingSave, patch: Partial<NotificationSettings['events']>) =>
    void row.run(() => saveNotificationEvent(qc, settings(), patch))
  const blocked = createSettingSave()
  const finished = createSettingSave()
  const failed = createSettingSave()
  const env = process.env
  const note = backendNote(env)
  const description = note ? `${alertSource(env)} ${note}` : alertSource(env)

  // Unseen on purpose, as on the desktop: the point is to fire every channel the mode allows, and a
  // notice about the task you are looking at is meant to be quiet.
  const sendTest = () => deliverNotice(
    { taskId: activeTaskId() ?? '', kind: 'agent-needs-input', title: 'Test agent needs you', at: Date.now() },
    { ...defaultDeliveryContext, focused: () => false },
  )

  return (
    <>
      <SettingsSection id="channels" label="How acorn tells you">
        <SettingRow label="Terminal alerts" description={description}>
          <Line>{MODE_LABEL[notifyMode(env)]}</Line>
        </SettingRow>
      </SettingsSection>
      <SettingsSection id="events" label="Notify me when" description="Turning an event off also keeps it out of the notification list.">
        <SettingRow label="An agent needs me" error={blocked.error()}>
          <Checkbox switch ariaLabel="An agent needs me" checked={settings().events.blocked} onChange={(on) => saveEvent(blocked, { blocked: on })} />
        </SettingRow>
        <SettingRow label="An agent finishes" error={finished.error()}>
          <Checkbox switch ariaLabel="An agent finishes" checked={settings().events.finished} onChange={(on) => saveEvent(finished, { finished: on })} />
        </SettingRow>
        <SettingRow label="An agent fails" error={failed.error()}>
          <Checkbox switch ariaLabel="An agent fails" checked={settings().events.error} onChange={(on) => saveEvent(failed, { error: on })} />
        </SettingRow>
      </SettingsSection>
      <SettingsSection id="test" label="Test">
        <SettingRow label="Test notification" description="Uses every channel the terminal alerts row allows.">
          <Button label="Send a test notification" onPress={sendTest}>Send a test notification</Button>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
