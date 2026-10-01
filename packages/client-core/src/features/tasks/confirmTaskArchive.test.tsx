import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WillConfirmationHost } from '../../host/registries/shell/willPhase'
import { confirmTaskArchive } from './confirmTaskArchive'

describe('confirmTaskArchive', () => {
  let host: HTMLElement
  let dispose: (() => void) | undefined
  // The dialog is a Modal, which portals to the body.
  const dialog = () => document.querySelector('[role="alertdialog"]')
  const footer = () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] .ui-modal-actions button')]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => <WillConfirmationHost />, host)
  })

  afterEach(() => {
    footer()[0]?.click()
    dispose?.()
    host.remove()
  })

  it('asks before archiving a task with no reported concerns', async () => {
    const decision = confirmTaskArchive({ id: 'task-1', branch: 'feature', worktreePath: '/tmp/worktrees/feature' })

    await expect.poll(() => dialog()?.textContent).toContain('deletes its worktree')
    expect(footer().map((button) => button.textContent)).toEqual(['Cancel', 'Archive task'])

    footer()[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [] })
  })

  it('says the project folder stays when the task has no worktree of its own', async () => {
    const decision = confirmTaskArchive({ id: 'task-2', branch: null, worktreePath: '/tmp/project' })

    await expect.poll(() => dialog()?.textContent).toContain('leaves the project folder as it is')
    expect(dialog()?.textContent).not.toContain('worktree')

    footer()[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [] })
  })
})
