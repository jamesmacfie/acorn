import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../infra/queries'
import { Button, Checkbox, Field } from '../../kit/components/primitives'
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
  const save = (patch: Partial<Settings>) => void saveNotificationSettings(qc, settings(), patch)
  const saveEvent = (patch: Partial<Settings['events']>) => void saveNotificationEvent(qc, settings(), patch)

  // Unseen on purpose: the point of the button is to fire every channel the switches above allow,
  // and an edge on the task you are looking at is meant to be quiet.
  const sendTest = () => deliverNotice(
    { taskId: activeTaskId() ?? '', kind: 'agent-needs-input', title: 'Test agent needs you', at: Date.now() },
    { ...defaultDeliveryContext, focused: () => false },
  )

  return (
    <>
      <Checkbox label="Play a sound" checked={settings().sound} onChange={(sound) => save({ sound })} />
      <Checkbox label="Show a system notification" checked={settings().system} onChange={(system) => save({ system })} />
      <Show when={canSetBadge()}>
        <Checkbox label="Show a count on the app icon" checked={settings().badge} onChange={(badge) => save({ badge })} />
      </Show>

      <Field label="Notify me when" group>
        <Checkbox label="An agent needs me" checked={settings().events.blocked} onChange={(blocked) => saveEvent({ blocked })} />
        <Checkbox label="An agent finishes" checked={settings().events.finished} onChange={(finished) => saveEvent({ finished })} />
        <Checkbox label="An agent fails" checked={settings().events.error} onChange={(error) => saveEvent({ error })} />
      </Field>

      <Button label="Send a test notification" onPress={sendTest} />
    </>
  )
}
