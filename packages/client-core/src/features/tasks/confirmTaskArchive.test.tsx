import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WillConfirmationHost } from '../../host/registries/shell/willPhase'
import { confirmTaskArchive } from './confirmTaskArchive'

describe('confirmTaskArchive', () => {
  let host: HTMLElement
  let dispose: (() => void) | undefined

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => <WillConfirmationHost />, host)
  })

  afterEach(() => {
    host.querySelector<HTMLButtonElement>('button')?.click()
    dispose?.()
    host.remove()
  })

  it('asks before archiving a task with no reported concerns', async () => {
    const decision = confirmTaskArchive('task-1')

    await expect.poll(() => host.querySelector('[role="alertdialog"]')?.textContent)
      .toContain('Are you sure you want to archive this task?')
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Archive task'])

    buttons[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [] })
  })
})
