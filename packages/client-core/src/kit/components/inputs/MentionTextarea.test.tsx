import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MentionTextarea, { type MentionSource } from './MentionTextarea'

// The field the agents composer is written against: three sigils, three lists, and a coloured copy of
// the draft behind the text (docs/ui-design.md § The closed kit).

let dispose: (() => void) | undefined
let host: HTMLElement

const SOURCES: MentionSource[] = [
  {
    sigil: '@',
    label: 'Worktree files',
    emptyText: 'No matching files.',
    suggest: (query) => ['src/app.ts', 'src/agent/state.ts']
      .filter((path) => path.includes(query))
      .map((path) => ({ value: `@${path}`, label: path })),
  },
  {
    sigil: '/',
    label: 'Provider commands',
    emptyText: 'No matching commands.',
    suggest: (query) => ['review', 'commit']
      .filter((name) => name.startsWith(query))
      .map((name) => ({ value: `/${name}`, label: `/${name}`, detail: 'a command' })),
  },
]

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const field = () => host.querySelector('textarea') as HTMLTextAreaElement
const list = () => host.querySelector('.ui-mentionfield-list')
const options = () => [...host.querySelectorAll('[role="option"]')]

/** Type into the field the way a person does: the value, the caret, then the event. */
const type = (text: string) => {
  const element = field()
  element.value = text
  element.setSelectionRange(text.length, text.length)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function mount(extra: Partial<Parameters<typeof MentionTextarea>[0]> = {}) {
  const [value, setValue] = createSignal('')
  dispose = render(() => (
    <MentionTextarea
      value={value()}
      onInput={setValue}
      sources={SOURCES}
      {...extra}
    />
  ), host)
  field().dispatchEvent(new FocusEvent('focus', { bubbles: true }))
  return value
}

describe('MentionTextarea', () => {
  it('opens the list for the sigil at the caret', () => {
    mount()
    type('Check @src/a')
    expect(list()?.getAttribute('aria-label')).toBe('Worktree files')
    expect(options().map((option) => option.textContent)).toContain('src/agent/state.ts')

    type('run /rev')
    expect(list()?.getAttribute('aria-label')).toBe('Provider commands')
    expect(options()).toHaveLength(1)
  })

  it('says so when a source has nothing to offer', () => {
    mount()
    type('run /zzz')
    expect(host.textContent).toContain('No matching commands.')
  })

  it('waits on a source that is still fetching, and only that one', () => {
    mount({ sources: [{ ...SOURCES[0], loading: true }, SOURCES[1]] })
    type('Check @src')
    expect(host.textContent).toContain('Loading…')
    type('run /rev')
    expect(host.textContent).not.toContain('Loading…')
    expect(options()).toHaveLength(1)
  })

  it('replaces the token under the caret and leaves one space', () => {
    const value = mount()
    type('run /rev')
    const option = options()[0]!.querySelector('button')!
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(value()).toBe('run /review ')
    expect(list()).toBeNull()
  })

  it('draws a coloured copy of the draft, and drops it when there is nothing to colour', () => {
    mount({
      segments: (text) => text.includes('/review')
        ? [{ text: 'run ' }, { text: '/review', tone: 'warn', caret: 11 }]
        : null,
    })
    expect(host.querySelector('.ui-mentionfield-mirror')).toBeNull()
    type('run /review')
    const token = host.querySelector('.ui-mentionfield-token')
    expect(token?.getAttribute('data-tone')).toBe('warn')
    expect(host.querySelector('.ui-mentionfield')?.hasAttribute('data-mirrored')).toBe(true)
  })

  it('keeps the field focused after a file paste redraws its caller', async () => {
    const elsewhere = document.createElement('button')
    host.append(elsewhere)
    const onFiles = vi.fn(() => elsewhere.focus())
    mount({ onFiles })
    field().focus()
    const image = new File(['image'], 'pasted.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { files: [image] } })

    field().dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    expect(onFiles).toHaveBeenCalledWith([image])
    expect(document.activeElement).toBe(elsewhere)

    await Promise.resolve()
    expect(document.activeElement).toBe(field())
  })
})
