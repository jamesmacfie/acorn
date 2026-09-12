import { createSignal, onCleanup } from 'solid-js'

// Arm-to-confirm, keyed. First request arms, the second commits, and a timeout disarms.
//
// Lifted from plugins/http/src/frame/confirmDelete.ts (the best of the five hand-rolled copies)
// plus docker's auto-reset timer. It is keyed because the armed state often has to live outside a
// single button: a group header arming one of nine rows needs to know which row is armed, and
// ConfirmButton is just the degenerate one-key case.
//
// Behaviour as a hook, markup at the call site; same idiom as dismissable.ts.

export type ArmedConfirm = {
  /** The key awaiting its second request, if any; drives the button's label. */
  armed: () => string | null
  /** True when the caller should go ahead. False means "armed, ask again". */
  request: (key: string) => boolean
  disarm: () => void
}

export function createArmedConfirm(timeoutMs: () => number = () => 3000): ArmedConfirm {
  const [armed, setArmed] = createSignal<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  // An armed button that outlives its own unmount would fire the timer against a disposed scope.
  onCleanup(clear)

  const disarm = () => {
    clear()
    setArmed(null)
  }

  return {
    armed,
    request: (key) => {
      if (armed() === key) {
        disarm()
        return true
      }
      clear()
      setArmed(key)
      timer = setTimeout(() => setArmed((current) => (current === key ? null : current)), timeoutMs())
      return false
    },
    disarm,
  }
}
