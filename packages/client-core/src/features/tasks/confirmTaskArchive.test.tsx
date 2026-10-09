import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WillConfirmationHost } from '../../host/registries/shell/willPhase'
import { confirmTaskArchive, confirmTaskDelete } from './confirmTaskArchive'

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
    const decision = confirmTaskArchive({ id: 'task-1', title: 'Add task search', branch: 'feature', worktreePath: '/tmp/worktrees/feature' })

    await expect.poll(() => dialog()?.textContent).toContain('deletes its worktree')
    expect(dialog()?.textContent).toContain('All subtasks, including nested subtasks, will also be archived.')
    expect(dialog()?.querySelector('.overlay-body')?.firstElementChild?.textContent).toBe('Add task search')
    expect(footer().map((button) => button.textContent)).toEqual(['Cancel', 'Archive task', ''])

    footer()[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [], action: 'archive' })
  })

  it('says the project folder stays when the task has no worktree of its own', async () => {
    const decision = confirmTaskArchive({ id: 'task-2', title: 'Review release notes', branch: null, worktreePath: '/tmp/project' })

    await expect.poll(() => dialog()?.textContent).toContain('leaves the project folder as it is')
    expect(dialog()?.textContent).toContain('All subtasks, including nested subtasks, will also be archived.')
    expect(dialog()?.querySelector('.overlay-body')?.firstElementChild?.textContent).toBe('Review release notes')
    expect(dialog()?.textContent).not.toContain('worktree')

    footer()[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [], action: 'archive' })
  })

  it('switches the confirm button to Delete task from its menu, with the warning', async () => {
    const decision = confirmTaskArchive({ id: 'task-3', title: 'Old spike', branch: 'spike', worktreePath: '/tmp/worktrees/spike' })

    await expect.poll(() => dialog()?.textContent).toContain('Archive task')
    expect(dialog()?.textContent).not.toContain("You can't restore a deleted task.")
    const deleteItem = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === 'Delete task')
    footer()[2]!.click()
    await expect.poll(deleteItem).toBeDefined()
    deleteItem()!.click()

    await expect.poll(() => footer()[1]?.textContent).toBe('Delete task')
    expect(footer()[1]!.dataset.tone).toBe('danger')
    expect(dialog()?.textContent).toContain("You can't restore a deleted task. The git branch stays.")
    footer()[1]!.click()
    await expect(decision).resolves.toEqual({ confirmed: true, checked: [], action: 'delete' })
  })

  it('offers only Delete task from the Archive page', async () => {
    const decision = confirmTaskDelete({ id: 'task-4', title: 'Old spike' })

    await expect.poll(() => footer().map((button) => button.textContent)).toEqual(['Cancel', 'Delete task'])
    expect(dialog()?.textContent).toContain("You can't restore a deleted task.")
    footer()[1]!.click()
    await expect(decision).resolves.toEqual({ confirmed: true, checked: [], action: 'delete' })
  })
})
