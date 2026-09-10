import { createSignal, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { Fold } from './Fold'

it('defers closed content until first opened and preserves it across subsequent toggles', () => {
  const host = document.createElement('div')
  let mounts = 0
  let disposals = 0
  const Content = () => {
    mounts++
    onCleanup(() => disposals++)
    return <input value="draft" />
  }
  const [open, setOpen] = createSignal(false)
  const dispose = render(() => (
    <Fold label="Completed subagent" open={open()} onOpenChange={setOpen}>
      <Content />
    </Fold>
  ), host)
  try {
    expect(mounts).toBe(0)
    setOpen(true)
    expect(mounts).toBe(1)
    const input = host.querySelector('input')!
    input.value = 'edited draft'
    setOpen(false)
    setOpen(true)
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('edited draft')
    expect(mounts).toBe(1)
    expect(disposals).toBe(0)
  } finally {
    dispose()
  }
  expect(disposals).toBe(1)
})

it('mounts an initially open section immediately', () => {
  const host = document.createElement('div')
  const dispose = render(() => <Fold label="Running" defaultOpen><span>Progress</span></Fold>, host)
  try { expect(host.textContent).toContain('Progress') } finally { dispose() }
})
