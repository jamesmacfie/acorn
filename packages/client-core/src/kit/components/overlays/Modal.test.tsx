import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Button } from '../primitives'
import { Modal } from './Modal'

// Where focus goes when a dialog opens and closes. Before this, a dialog without `autoFocus` left
// focus on the button behind the scrim, so the next Tab walked the page and a screen reader heard
// nothing about the dialog.

let dispose: (() => void) | undefined
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const mount = (body: () => ReturnType<typeof Modal>) => {
  const [open, setOpen] = createSignal(false)
  dispose = render(() => (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>open</button>
      <Show when={open()}>{body()}</Show>
    </>
  ), host)
  const opener = host.querySelector<HTMLButtonElement>('#opener')!
  opener.focus()
  return { opener, open: () => setOpen(true), close: () => setOpen(false) }
}

describe('a Modal without autoFocus', () => {
  it('moves focus to the first control in its body, and back to the opener on close', async () => {
    let close = () => {}
    const view = mount(() => (
      <Modal title="Rename session" onDismiss={() => close()}>
        <Modal.Body><input aria-label="Name" /></Modal.Body>
        <Modal.Actions><Button variant="solid">Save</Button></Modal.Actions>
      </Modal>
    ))
    close = view.close
    view.open()
    await settle()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Name')
    view.close()
    expect(document.activeElement).toBe(view.opener)
  })

  it('starts an alertdialog on the button that does not confirm', async () => {
    const view = mount(() => (
      <Modal title="Archive session" role="alertdialog" onDismiss={() => {}}>
        <Modal.Body>Archive it?</Modal.Body>
        <Modal.Actions>
          <Button variant="ghost">Cancel</Button>
          <Button variant="solid" tone="danger">Archive</Button>
        </Modal.Actions>
      </Modal>
    ))
    view.open()
    await settle()
    expect(document.activeElement?.textContent).toBe('Cancel')
  })

  it('names itself by its title, draws a close button, and holds focus when its body cannot', async () => {
    const view = mount(() => (
      <Modal title="Keyboard shortcuts" onDismiss={() => {}}>
        <Modal.Body>list</Modal.Body>
      </Modal>
    ))
    view.open()
    await settle()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Keyboard shortcuts')
    expect(dialog.querySelector('button[aria-label="Close"]')).not.toBeNull()
    expect(document.activeElement).toBe(dialog)
  })

  it('draws no close button when nothing may dismiss it', async () => {
    const view = mount(() => (
      <Modal title="Set up acorn" dismissOn={[]} onDismiss={() => {}}>
        <Modal.Body>steps</Modal.Body>
      </Modal>
    ))
    view.open()
    await settle()
    expect(document.querySelector('[role="dialog"] button[aria-label="Close"]')).toBeNull()
  })
})
