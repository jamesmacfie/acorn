import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { Input } from '../../kit/components/inputs/Input'
import { Checkbox } from '../../kit/components/inputs/Checkbox'
import { createTextSetting } from './settingSave'

// The save model's two promises for a text field, each one something a person would notice at once:
// a write that lands says so for a moment, and a write that fails keeps what they typed and says why.

let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.useRealTimers()
})

const mount = (write: (value: string) => Promise<unknown>) => {
  const [stored, setStored] = createSignal('4000')
  dispose = render(() => {
    const port = createTextSetting({
      value: stored,
      save: async (value) => {
        await write(value)
        setStored(value)
      },
    })
    return (
      <SettingRow label="Port" savedAt={port.savedAt()} error={port.error()}>
        <Input label="Port" value={port.value()} onInput={port.input} onChange={(value) => void port.commit(value)} />
      </SettingRow>
    )
  }, host)
  const field = host.querySelector('input')!
  return {
    field,
    stored,
    type: (value: string) => {
      field.value = value
      field.dispatchEvent(new InputEvent('input', { bubbles: true }))
      // What the browser fires on blur, and on Enter, for a field whose text changed.
      field.dispatchEvent(new Event('change', { bubbles: true }))
    },
  }
}

const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}
const status = () => host.querySelector('.ui-setting-status')?.textContent
const error = () => host.querySelector('.ui-setting-error')?.textContent

describe('a text setting', () => {
  it('shows Saved for about two seconds after a write lands', async () => {
    const row = mount(async () => {})
    row.type('4100')
    await settle()
    expect(row.stored()).toBe('4100')
    expect(status()).toBe('Saved')
    vi.advanceTimersByTime(2000)
    expect(status()).toBe('')
  })

  it('shows Saved beside the label, so the control column holds only the control', async () => {
    const row = mount(async () => {})
    row.type('4100')
    await settle()
    expect(host.querySelector('.ui-setting-title .ui-setting-status')?.textContent).toBe('Saved')
    expect([...host.querySelector('.ui-setting-control')!.children].map((child) => child.tagName)).toEqual(['FIELDSET'])
  })

  it('keeps the typed value and shows the error when the write fails', async () => {
    const row = mount(async () => { throw new Error('The node is offline.') })
    row.type('4100')
    await settle()
    expect(row.stored()).toBe('4000')
    expect(row.field.value).toBe('4100')
    expect(error()).toBe('The node is offline.')
    expect(status()).toBe('')
  })

  it('writes nothing when the committed value is the stored one', async () => {
    const write = vi.fn(async () => {})
    const row = mount(write)
    row.type('4000')
    await settle()
    expect(write).not.toHaveBeenCalled()
    expect(status()).toBe('')
  })
})

describe('a setting row', () => {
  it('turns its control inert and says where the value comes from when it is set elsewhere', () => {
    dispose = render(() => (
      <SettingRow label="Setup script" from=".acorn/config.toml">
        <Input label="Setup script" value="pnpm install" />
      </SettingRow>
    ), host)
    expect(host.querySelector('.ui-setting-from')?.textContent).toBe('From .acorn/config.toml')
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    // The value this machine holds stays on screen underneath.
    expect(host.querySelector('input')?.value).toBe('pnpm install')
  })

  it('names a device row by its label and its chip, without the changed dot', () => {
    dispose = render(() => (
      <SettingRow label="Tool call display" scope="device" onReset={() => {}}>
        <Input label="Tool call display" value="collapsed" />
      </SettingRow>
    ), host)
    const group = host.querySelector('[role="group"]')!
    const name = group.getAttribute('aria-labelledby')!.split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ')
    expect(name).toBe('Tool call display This device')
  })

  it('keeps its help mark out of the name, and a device row still says its chip', () => {
    dispose = render(() => (
      <SettingRow label="Tool call display" scope="device" help="How a tool call starts out.">
        <Input label="Tool call display" value="collapsed" />
      </SettingRow>
    ), host)
    const group = host.querySelector('[role="group"]')!
    const ids = group.getAttribute('aria-labelledby')!.split(' ')
    expect(ids.map((id) => document.getElementById(id)?.textContent).join(' ')).toBe('Tool call display This device')
    const mark = host.querySelector<HTMLButtonElement>('.ui-help')!
    expect(ids.some((id) => mark.contains(document.getElementById(id)))).toBe(false)
    expect(mark.dataset.tip).toBe('How a tool call starts out.')
    // The mark sits on the title line, after the label and before the chip.
    const line = [...host.querySelector('.ui-setting-title')!.children].map((child) => child.className)
    expect(line.indexOf('ui-titled')).toBeLessThan(line.indexOf('ui-setting-scope'))
  })

  it('labels its one control, so clicking the label flips a switch', () => {
    const flip = vi.fn()
    dispose = render(() => (
      <SettingRow label="Play a sound" description="On every notification.">
        <Checkbox switch checked={false} onChange={flip} />
      </SettingRow>
    ), host)
    const label = host.querySelector<HTMLLabelElement>('label.ui-setting-label')!
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(label.htmlFor).toBe(box.id)
    expect(box.getAttribute('aria-describedby')).toBe(host.querySelector('.ui-setting-description')!.id)
    label.click()
    expect(flip).toHaveBeenCalledWith(true)
  })

  it('leaves two controls to their own names', () => {
    dispose = render(() => (
      <SettingRow label="Window size">
        <Input label="Width" value="1440" />
        <Input label="Height" value="900" />
      </SettingRow>
    ), host)
    expect(host.querySelector<HTMLLabelElement>('label.ui-setting-label')!.htmlFor).toBe('')
    expect(host.querySelector('[role="group"]')).not.toBeNull()
  })

  it('offers Reset, with the dot, only while it has somewhere to reset to', () => {
    const reset = vi.fn()
    const [changed, setChanged] = createSignal(true)
    dispose = render(() => (
      <SettingRow label="Concurrent agents" onReset={changed() ? reset : undefined}>
        <Input label="Concurrent agents" value="8" />
      </SettingRow>
    ), host)
    const button = () => [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Reset')
    expect(host.querySelector('.ui-setting-changed')).not.toBeNull()
    button()!.click()
    expect(reset).toHaveBeenCalledTimes(1)
    setChanged(false)
    expect(button()).toBeUndefined()
    expect(host.querySelector('.ui-setting-changed')).toBeNull()
  })
})
