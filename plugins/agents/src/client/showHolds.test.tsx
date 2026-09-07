import { describe, expect, it } from 'vitest'
import { createMemo, createRoot, createSignal, Show } from 'solid-js'

// The narrowed accessor a `<Show>` hands its child keeps the last value once `when` clears, instead
// of throwing "Stale read from <Show>". That is our patch to solid-js (patches/README.md), and this
// is the check that the installed copy carries it: a memo under the Show reads the accessor in the
// same tick the session goes away, which is what every agents pane does when a run is closed.
describe('a patched <Show>', () => {
  it('holds the last value for a child that reads it after when clears', () => {
    createRoot((dispose) => {
      const [session, setSession] = createSignal<{ id: string } | undefined>({ id: 'a' })
      let seen: () => string = () => ''
      Show({
        get when() { return session() },
        children: (narrowed: () => { id: string }) => {
          seen = createMemo(() => narrowed().id)
          return null
        },
      })
      expect(seen()).toBe('a')
      setSession({ id: 'b' })
      expect(seen()).toBe('b')
      setSession(undefined)
      expect(() => seen()).not.toThrow()
      expect(seen()).toBe('b')
      dispose()
    })
  })
})
