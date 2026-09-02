import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../infra/queries'
import { saveJsonPref } from './savePref'
import { Button, Checkbox, Field } from '../../kit/components/primitives'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { parseNotificationSettings, type NotificationSettings as Settings } from '../notifications/settings'
import { defaultDeliveryContext, deliverNotice } from '../notifications/deliver'
import { activeTaskId } from '../tasks/tasks'

// Settings → Notifications: the switches the gate reads
// (docs/future/notifications/model.md § The gate).
//
// The three event switches turn an edge off entirely, row included. Off means the owner does not
// want to hear about it, and a row that lands silently but still counts in the pill is hearing
// about it.
//
// There is no badge switch yet. The number on the app icon needs a host that can draw one, and no
// build installs that seam, so the row is absent rather than greyed out: docs/frontend.md refuses a
// disabled control with a tooltip where hiding says the true thing.
export default function NotificationSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const settings = () => parseNotificationSettings(prefs.data?.[PrefKeys.notifications])

  const save = (patch: Partial<Settings>) =>
    void saveJsonPref(qc, PrefKeys.notifications, { ...settings(), ...patch })
  const saveEvent = (patch: Partial<Settings['events']>) => save({ events: { ...settings().events, ...patch } })

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

      <Field label="Notify me when" group>
        <Checkbox label="An agent needs me" checked={settings().events.blocked} onChange={(blocked) => saveEvent({ blocked })} />
        <Checkbox label="An agent finishes" checked={settings().events.finished} onChange={(finished) => saveEvent({ finished })} />
        <Checkbox label="An agent fails" checked={settings().events.error} onChange={(error) => saveEvent({ error })} />
      </Field>

      <Button label="Send a test notification" onPress={sendTest} />
    </>
  )
}
