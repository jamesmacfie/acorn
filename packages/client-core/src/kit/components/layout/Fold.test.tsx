import { createSignal, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { Fold } from './Fold'
import { Button, Row } from '../primitives'

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

// A slot a Show tests and then inserts is two reads of a prop getter, and each read runs the caller's
// JSX. Every mark in a transcript's tool cards and file rows was built twice that way.
it('builds each slot once, in a fold header and a row', () => {
  const host = document.createElement('div')
  let built = 0
  const Mark = () => {
    built++
    return <b>mark</b>
  }
  const dispose = render(() => (
    <>
      <Fold label="Tool" leading={<Mark />} meta={<Mark />} actions={<Mark />}>
        <span />
      </Fold>
      <Row leading={<Mark />} meta={<Mark />} trailing={<Mark />}>Changed files</Row>
      <Button label="Copy"><Mark /></Button>
    </>
  ), host)
  try {
    expect(host.querySelectorAll('b')).toHaveLength(7)
    expect(built).toBe(7)
  } finally {
    dispose()
  }
})

// The include box on a Context section rides here, and pressing it must not open or close the fold.
it('draws a leading control before the label without toggling the fold', () => {
  const host = document.createElement('div')
  const dispose = render(() => (
    <Fold label="Notes" leading={<input type="checkbox" aria-label="Include notes" />}>
      <span>Body</span>
    </Fold>
  ), host)
  try {
    const summary = host.querySelector('summary')!
    const box = summary.querySelector('input')!
    expect(box.compareDocumentPosition(summary.querySelector('.ui-section-header-label')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    box.click()
    expect(box.checked).toBe(true)
    expect(host.querySelector('details')!.open).toBe(false)
  } finally {
    dispose()
  }
})
