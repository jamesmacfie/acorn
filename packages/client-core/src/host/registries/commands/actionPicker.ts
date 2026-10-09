import { createSignal } from 'solid-js'

export type ActionPickerRequest = {
  title: string
  detail: string
  actions: ReadonlyArray<{ id: string; label: string; run: () => void }>
}

// A collection can request a host-level action list when its own region is too narrow to contain
// a menu. The callback stays attached to the pinned row observation, not a later selection.
const [request, setRequest] = createSignal<ActionPickerRequest | null>(null)
export const actionPickerRequest = request
export const openActionPicker = (next: ActionPickerRequest): void => { setRequest(next) }
export const closeActionPicker = (): void => { setRequest(null) }
