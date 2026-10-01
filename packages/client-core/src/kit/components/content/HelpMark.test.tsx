import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Field } from '../inputs/Field'
import { Input } from '../inputs/Input'
import { SettingsSection } from '../layout/SettingsSection'
import { SectionHeader } from '../layout/SectionHeader'
import { HelpMark } from './HelpMark'

// The "?" beside a title. What a person relies on: the tip it opens, what a screen reader calls it,
// and that a tap shows it on a screen with no hover.

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

const text = (ids: string | null) => (ids ?? '').split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')

describe('HelpMark', () => {
  it('opens the help text as a help tip, and reads as "About" and the title', () => {
    dispose = render(() => (
      <>
        <span id="title">Stop idle agents after</span>
        <HelpMark text="An idle agent can hold hundreds of megabytes." titleId="title" />
      </>
    ), host)
    const mark = host.querySelector<HTMLButtonElement>('button.ui-help')!
    expect(mark.type).toBe('button')
    expect(mark.dataset.tip).toBe('An idle agent can hold hundreds of megabytes.')
    expect(mark.dataset.tipKind).toBe('help')
    expect(text(mark.getAttribute('aria-labelledby'))).toBe('About Stop idle agents after')
    expect(text(mark.getAttribute('aria-describedby'))).toBe('An idle agent can hold hundreds of megabytes.')
  })

  it('takes focus when pressed, so a tap shows the tip', () => {
    dispose = render(() => <HelpMark text="Why" titleId="none" />, host)
    const mark = host.querySelector<HTMLButtonElement>('button.ui-help')!
    mark.click()
    expect(document.activeElement).toBe(mark)
  })
})

describe('the hosts that draw one', () => {
  it('draw nothing extra without help', () => {
    dispose = render(() => (
      <>
        <SettingsSection id="a" label="Idle agents"><span /></SettingsSection>
        <SectionHeader>Definitions</SectionHeader>
      </>
    ), host)
    expect(host.querySelector('.ui-help, .ui-titled')).toBeNull()
  })

  it('keep the mark outside the heading that names a section', () => {
    dispose = render(() => (
      <>
        <SettingsSection id="a" label="New sessions" help="Each new session starts with these."><span /></SettingsSection>
        <SectionHeader count={3} help="A workflow is a list of steps.">Definitions</SectionHeader>
      </>
    ), host)
    const section = host.querySelector('section')!
    expect(text(section.getAttribute('aria-labelledby'))).toBe('New sessions')
    const [first, second] = host.querySelectorAll<HTMLButtonElement>('.ui-help')
    expect(text(first.getAttribute('aria-labelledby'))).toBe('About New sessions')
    expect(text(second.getAttribute('aria-labelledby'))).toBe('About Definitions')
    // Title, then the mark, then the count.
    const header = host.querySelector('.section-header')!
    expect([...header.children].map((child) => child.className)).toEqual(['ui-titled', 'ui-section-header-count'])
  })
})

describe('Field', () => {
  it('names its control by the caption alone and describes it with the hint, error, and help', () => {
    dispose = render(() => (
      <Field label="Port" hint="The port the server listens on." error="Taken." help="Only this computer can reach it.">
        <Input value="4000" />
      </Field>
    ), host)
    const input = host.querySelector('input')!
    const caption = host.querySelector<HTMLLabelElement>('label.ui-field-label')!
    expect(caption.htmlFor).toBe(input.id)
    expect(caption.textContent).toBe('Port')
    expect(host.querySelector('.ui-field')!.tagName).toBe('DIV')
    expect(text(input.getAttribute('aria-describedby'))).toBe('The port the server listens on. Taken. Only this computer can reach it.')
  })

  it('keeps the id a caller gave its control', () => {
    dispose = render(() => <Field label="Name"><Input id="name-box" /></Field>, host)
    expect(host.querySelector<HTMLLabelElement>('label.ui-field-label')!.htmlFor).toBe('name-box')
  })

  it('as a group, names the group and leaves each control its own label', () => {
    dispose = render(() => (
      <Field label="Size" group>
        <Input label="Width" />
        <Input label="Height" />
      </Field>
    ), host)
    const group = host.querySelector('[role="group"]')!
    expect(text(group.getAttribute('aria-labelledby'))).toBe('Size')
    expect([...host.querySelectorAll('input')].every((input) => !input.id)).toBe(true)
  })
})
