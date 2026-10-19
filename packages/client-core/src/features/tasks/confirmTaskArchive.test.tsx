import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WillConfirmationHost } from '../../host/registries/shell/willPhase'
import { activeCacheId } from '../../infra/node/activeNode'
import { clientFor } from '../../infra/node/fleet'
import { tasksKey } from '../../infra/queries'
import { confirmTaskArchive, confirmTaskDelete } from './confirmTaskArchive'

describe('confirmTaskArchive', () => {
  let host: HTMLElement
  let dispose: (() => void) | undefined
  // The dialog is a Modal, which portals to the body.
  const dialog = () => document.querySelector('[role="alertdialog"]')
  const footer = () => [
    ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] .ui-modal-actions button'),
  ]

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

  it.each([false, true])('asks before archiving a worktree task with children: %s', async (hasChildren) => {
    const decision = confirmTaskArchive(
      {
        id: 'task-1',
        title: 'Add task search',
        branch: 'feature',
        worktreePath: '/tmp/worktrees/feature',
      },
      [{ parentId: hasChildren ? 'task-1' : 'other-task' }],
    )

    await expect.poll(() => dialog()?.textContent).toContain('deletes its worktree')
    expect(dialog()?.textContent?.includes('All subtasks, including nested subtasks, will also be archived.')).toBe(
      hasChildren,
    )
    expect(dialog()?.textContent).toContain('You can restore tasks from Archive.')
    expect(dialog()?.querySelector('.overlay-body')?.firstElementChild?.textContent).toBe('Add task search')
    expect(footer().map((button) => button.textContent)).toEqual(['Cancel', 'Archive task', ''])

    footer()[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [], action: 'archive' })
  })

  it.each([false, true])('says the project folder stays with children: %s', async (hasChildren) => {
    const decision = confirmTaskArchive(
      {
        id: 'task-2',
        title: 'Review release notes',
        branch: null,
        worktreePath: '/tmp/project',
      },
      hasChildren ? [{ parentId: 'task-2' }] : [],
    )

    await expect.poll(() => dialog()?.textContent).toContain('leaves the project folder as it is')
    expect(dialog()?.textContent?.includes('All subtasks, including nested subtasks, will also be archived.')).toBe(
      hasChildren,
    )
    expect(dialog()?.textContent).toContain('You can restore tasks from Archive.')
    expect(dialog()?.querySelector('.overlay-body')?.firstElementChild?.textContent).toBe('Review release notes')
    expect(dialog()?.textContent).not.toContain('worktree')

    footer()[0]!.click()
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [], action: 'archive' })
  })

  it('closes once another client archives the task', async () => {
    const client = clientFor(activeCacheId()).client
    client.setQueryData(tasksKey, [{ id: 'task-4' }, { id: 'task-5' }])
    const decision = confirmTaskArchive(
      { id: 'task-4', title: 'Archived elsewhere', branch: null, worktreePath: '/tmp/project' },
      [],
    )
    await expect.poll(() => dialog()?.textContent).toContain('Archived elsewhere')

    client.setQueryData(tasksKey, [{ id: 'task-5' }])
    await expect(decision).resolves.toEqual({ confirmed: false, checked: [], action: 'archive' })
    expect(dialog()).toBeNull()
    client.removeQueries({ queryKey: tasksKey })
  })

  it('switches the confirm button to Delete task from its menu, with the warning', async () => {
    const decision = confirmTaskArchive(
      {
        id: 'task-3',
        title: 'Old spike',
        branch: 'spike',
        worktreePath: '/tmp/worktrees/spike',
      },
      [],
    )

    await expect.poll(() => dialog()?.textContent).toContain('Archive task')
    expect(dialog()?.textContent).not.toContain("You can't restore a deleted task.")
    const deleteItem = () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === 'Delete task',
      )
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
