import { For, Show, createResource, onCleanup, onMount } from 'solid-js'
import type { BridgePendingRequest } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'

const NOTIFICATIONS = { permissions: ['notifications'] }
const KIND_LABELS: Record<string, string> = { permission: 'Permission', question: 'Question', elicitation: 'Question' }

// The requests agents are waiting on for this page's projects, the same ones the toolbar badge counts,
// and the opt-in for OS notifications of them. Choosing one opens its conversation, where it is
// answered. docs/browser-extension/notifications.md.
export function Waiting(props: {
  permissions: BrowserApi['permissions']
  requests: readonly BridgePendingRequest[]
  // Whose requests these are: the page's projects, or the project chosen for a page with none.
  scope: string
  open(request: BridgePendingRequest): void
}) {
  // The browser permission is the opt-in, so turning it off in the browser's settings turns it off here.
  const [allowed, { refetch }] = createResource(() => props.permissions.contains(NOTIFICATIONS))
  const onAccess = () => void refetch()
  onMount(() => {
    props.permissions.onAdded.addListener(onAccess)
    props.permissions.onRemoved.addListener(onAccess)
  })
  onCleanup(() => {
    props.permissions.onAdded.removeListener(onAccess)
    props.permissions.onRemoved.removeListener(onAccess)
  })
  // `request` must run inside the person's click, so nothing is awaited before it.
  // A declined prompt fires no permission event, so the box is set from the browser's answer.
  const toggle = (box: HTMLInputElement) => {
    const asked = box.checked ? props.permissions.request(NOTIFICATIONS) : props.permissions.remove(NOTIFICATIONS)
    void asked
      .catch(() => false)
      .then(async () => {
        box.checked = await props.permissions.contains(NOTIFICATIONS)
      })
  }

  return (
    <section class="card" aria-label="Waiting for you">
      <h2>Waiting for you</h2>
      <Show when={props.requests.length} fallback={<p class="quiet">No agent is waiting on {props.scope}.</p>}>
        <ul>
          <For each={props.requests}>
            {(request) => (
              <li>
                <div>
                  <strong>{request.title}</strong>
                  <span class="quiet">
                    {KIND_LABELS[request.kind] ?? 'Request'} · {request.taskTitle}
                  </span>
                </div>
                <button type="button" class="quiet" onClick={() => props.open(request)}>
                  Open
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <label class="row">
        <input
          type="checkbox"
          name="notify"
          checked={allowed() === true}
          onChange={(event) => toggle(event.currentTarget)}
        />
        Notify me when an agent waits on the projects of the page I'm on
      </label>
    </section>
  )
}
