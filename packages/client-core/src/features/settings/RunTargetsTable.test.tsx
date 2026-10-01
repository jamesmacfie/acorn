import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunTargetsTable } from './RunTargetsTable'

// Run targets used to be a JSON array typed into a box. The table must write back the same array: a
// key it does not show survives an edit, one default stays one default, and a target the repo
// declares cannot be edited from here.

let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const STORED = JSON.stringify([
  { id: 'dev', command: 'pnpm dev', icon: 'rocket', default: true },
  { id: 'storybook', command: 'pnpm storybook', url: 'http://localhost:6006' },
])

const mount = (repoTargets: { id: string; command: string }[] = []) => {
  const [stored, setStored] = createSignal<string | null>(STORED)
  const save = vi.fn(async (json: string) => { setStored(json || null) })
  dispose = render(() => <RunTargetsTable stored={stored()} repoTargets={repoTargets} save={save} />, host)
  return { save, written: () => JSON.parse(save.mock.lastCall![0]) as unknown[] }
}

const button = (label: string, within: ParentNode = host) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].filter((item) => item.textContent === label)
const type = (label: string, value: string) => {
  const field = host.querySelector<HTMLInputElement>(`form input[aria-label="${label}"]`)!
  field.value = value
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
}
const rowOf = (name: string) => [...host.querySelectorAll('tbody tr, table > tr')].find((row) => row.querySelector('th')?.textContent === name)!
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('RunTargetsTable', () => {
  it('writes the stored array back with an edit, the default moved and untouched keys kept', async () => {
    const { save, written } = mount()
    button('Edit', rowOf('storybook'))[0]!.click()
    type('Command', 'pnpm sb')
    host.querySelector<HTMLInputElement>('form input[type="checkbox"]')!.click()
    button('Save')[0]!.click()
    await settle()

    expect(save).toHaveBeenCalledTimes(1)
    expect(written()).toEqual([
      { id: 'dev', command: 'pnpm dev', icon: 'rocket' },
      { id: 'storybook', command: 'pnpm sb', url: 'http://localhost:6006', default: true },
    ])
    // The form closes and the table shows what was stored.
    expect(host.querySelector('form')).toBeNull()
    expect(rowOf('storybook').textContent).toContain('pnpm sb')
  })

  it('adds a target, refuses a duplicate name before writing, and removes one at once', async () => {
    const { save, written } = mount()
    button('Add run target')[0]!.click()
    type('Name', 'dev')
    type('Command', 'make dev')
    button('Save')[0]!.click()
    await settle()
    expect(save).not.toHaveBeenCalled()
    expect(host.querySelector('form')?.textContent).toContain('Another run target is already called dev.')

    type('Name', 'lint')
    button('Save')[0]!.click()
    await settle()
    expect(written()).toEqual([
      { id: 'dev', command: 'pnpm dev', icon: 'rocket', default: true },
      { id: 'storybook', command: 'pnpm storybook', url: 'http://localhost:6006' },
      { id: 'lint', command: 'make dev' },
    ])

    button('Remove', rowOf('storybook'))[0]!.click()
    await settle()
    expect(written().map((target) => (target as { id: string }).id)).toEqual(['dev', 'lint'])
  })

  it('lists the repo\'s targets read-only and keeps the machine target they replace', () => {
    mount([{ id: 'dev', command: './scripts/dev.sh' }])
    const repoRow = host.querySelector('[data-from]')!
    expect(repoRow.textContent).toContain('From .acorn/config.toml')
    expect(repoRow.textContent).toContain('./scripts/dev.sh')
    expect(button('Edit', repoRow)).toEqual([])
    // This machine's `dev` is still listed, and says why it does nothing while the repo declares one.
    const machineDev = [...host.querySelectorAll('tr')].filter((row) => row.querySelector('th')?.textContent === 'dev').at(-1)!
    expect(machineDev.textContent).toContain('pnpm dev')
    expect(machineDev.textContent).toContain('Replaced by the repo')
    expect(button('Edit', machineDev)).toEqual([])
  })
})
