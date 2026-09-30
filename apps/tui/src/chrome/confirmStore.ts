import { createSignal } from 'solid-js'

// The shell's one confirmation on this host: `confirmAction` from `@acorn/plugin-api/ui/host`
// (../kit/host.tsx). A danger zone asks it before a delete, an unpair or a revoke, and a settings form
// asks it before its unsaved changes are dropped.
//
// A queue, like ./filePrompt.ts, because the question is a promise its caller awaits and a second one
// can arrive before the first is answered. It is drawn by the shell over whatever has the screen, and
// that surface stays mounted underneath, so the page that asked is still there when the answer lands
// (./Shell.tsx, ./Confirmation.tsx).

export type ConfirmRequest = {
  title: string
  actionLabel: string
  /** What the action removes. */
  goes: string
  /** What it leaves alone. */
  stays?: string
  danger?: boolean
}

type Queued = { request: ConfirmRequest; resolve: (confirmed: boolean) => void }
const queue: Queued[] = []
const [active, setActive] = createSignal<ConfirmRequest | null>(null)
export const activeConfirmation = active

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ request, resolve })
    if (queue.length === 1) setActive(request)
  })
}

export function finishConfirmation(confirmed: boolean): void {
  const current = queue.shift()
  if (!current) return
  current.resolve(confirmed)
  setActive(queue[0]?.request ?? null)
}

/** Test teardown answers every open question no, so nothing awaits a dialog a later render never draws. */
export function resetConfirmations(): void {
  while (queue.length) finishConfirmation(false)
}
