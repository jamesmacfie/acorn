import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../infra/queries'
import { Button, Checkbox } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { canSetBadge } from '../../infra/platform'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import {
  parseNotificationSettings,
  saveNotificationEvent,
  saveNotificationSettings,
  type NotificationSettings as Settings,
} from '../notifications/settings'
import { defaultDeliveryContext, deliverNotice } from '../notifications/deliver'
import { activeTaskId } from '../tasks/tasks'
import { createSettingSave, type SettingSave } from './settingSave'
import { Show } from 'solid-js'

// Settings → Notifications: the switches the gate reads
// (docs/notifications.md § Settings).
//
// The three event switches turn an edge off entirely, row included. Off means the owner does not
// want to hear about it, and a row that lands silently but still counts in the pill is hearing
// about it.
//
// The badge row appears only where the host can draw a number on the app icon — a desktop shell, not
// a page. Absent rather than greyed out: docs/frontend.md refuses a disabled control with a tooltip
// where hiding says the true thing.
export default function NotificationSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const settings = () => parseNotificationSettings(prefs.data?.[PrefKeys.notifications])

  // Both through the shared merge (../notifications/settings.ts), which is the same one the palette's
  // setting commands write with: six booleans in one key means an unmerged write turns five of them off.
  // Each switch has its own save state, so a failed write is reported beside the switch that moved.
  const save = (row: SettingSave, patch: Partial<Settings>) => row.run(() => saveNotificationSettings(qc, settings(), patch))
  const saveEvent = (row: SettingSave, patch: Partial<Settings['events']>) => row.run(() => saveNotificationEvent(qc, settings(), patch))
  const sound = createSettingSave()
  const system = createSettingSave()
  const badge = createSettingSave()
  const blocked = createSettingSave()
  const finished = createSettingSave()
  const failed = createSettingSave()

  // Unseen on purpose: the point of the button is to fire every channel the switches above allow,
  // and an edge on the task you are looking at is meant to be quiet.
  const sendTest = () => deliverNotice(
    { taskId: activeTaskId() ?? '', kind: 'agent-needs-input', title: 'Test agent needs you', at: Date.now() },
    { ...defaultDeliveryContext, focused: () => false },
  )

  return (
    <>
      <SettingsSection id="channels" label="How acorn tells you">
        <SettingRow label="Play a sound" error={sound.error()}>
          <Checkbox switch ariaLabel="Play a sound" checked={settings().sound} onChange={(on) => save(sound, { sound: on })} />
        </SettingRow>
        <SettingRow label="Show a system notification" error={system.error()}>
          <Checkbox switch ariaLabel="Show a system notification" checked={settings().system} onChange={(on) => save(system, { system: on })} />
        </SettingRow>
        <Show when={canSetBadge()}>
          <SettingRow label="Show a count on the app icon" error={badge.error()}>
            <Checkbox switch ariaLabel="Show a count on the app icon" checked={settings().badge} onChange={(on) => save(badge, { badge: on })} />
          </SettingRow>
        </Show>
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
        <SettingRow label="Test notification" description="Uses every channel that is turned on above.">
          <Button label="Send a test notification" onPress={sendTest} />
        </SettingRow>
      </SettingsSection>
    </>
  )
}
