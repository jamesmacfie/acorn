import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalStatus } from '@acorn/protocol/terminal.ts'
import {
  extensionPointRegistry,
  extensionRegistry,
  type Disposable,
  type ExtensionContribution,
} from '@acorn/plugin-api/testkit/client'
import type { ChangesModel } from './changesModel'
import { RemoteBar } from './RemoteBar'
import { PUSH_ACTIONS_MAX, PUSH_ACTIONS_POINT, type PushActionsProps } from './extensionPoints'
import { emptyLocalStatus } from '../shared/api'

// The branch bar in jsdom, which is the tier that can answer what a press does. The pure half — which
// verb is next, what the counts read, what a refusal turns into — is in model.test.ts next door.
//
// The model is a stand-in, for the reason phase 0's list test gives: `createChangesModel` fetches over
// HTTP and subscribes to the task poll, and neither is what a button is about.

// The one thing the slot under the bar reads that needs a shell behind it: the reader's arbitration
// preference. Nothing else in this file touches the query layer, because the model is a stand-in
// (plugins/agents/src/client/composer/AttachmentSlot.test.tsx set this shape).
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))

const remote = vi.fn()

const model = (status: Partial<LocalStatus>, busy = false): ChangesModel => ({
  task: { id: 't1', projectId: 'p1' },
  isGit: () => true,
  status: () => ({ ...emptyLocalStatus(), ...status }),
  project: () => ({ name: 'widget', path: '/src/widget' }),
  remoteBusy: () => busy,
  remote,
} as unknown as ChangesModel)

let host: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

const registered: Disposable[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const dispose of registered.splice(0)) dispose.dispose()
  host.remove()
  for (const surface of document.querySelectorAll('.ui-menu')) surface.remove()
  remote.mockClear()
})

// Built before the render, not inside it: a JSX prop is a getter, so `model={model(...)}` would mint
// a new one on every read.
const draw = (status: Partial<LocalStatus>, busy = false) => {
  const built = model(status, busy)
  disposers.push(render(() => <RemoteBar model={built} />, host))
  return host
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
const byText = (label: string) => buttons().find((button) => button.textContent?.trim() === label)
/** The bar's primary button: the one that is neither the menu trigger nor a copy button. */
const primary = (): HTMLButtonElement =>
  buttons().find((button) => button.classList.contains('ui-btn') && !button.getAttribute('aria-haspopup') && !button.closest('.ui-alert'))!
const menuTrigger = () => host.querySelector<HTMLButtonElement>('button[aria-label="Remote actions"]')!
const openMenu = () => {
  menuTrigger().click()
  return [...document.querySelectorAll<HTMLElement>('.ui-menu button')]
}

describe('the primary button', () => {
  it('reads Publish on a branch with no upstream', () => {
    draw({ branch: 'james/thing' })
    expect(primary().textContent?.trim()).toBe('Publish')
    // Same call as a push, which the hint is the one place a reader can see.
    expect(primary().getAttribute('data-tip-sub')).toBe('git push --set-upstream origin HEAD')
  })

  it('reads Pull when the branch is behind, Push when it is ahead, and Fetch in sync', () => {
    const cases: [Partial<LocalStatus>, string][] = [
      [{ upstream: 'origin/main', ahead: 0, behind: 2 }, 'Pull'],
      [{ upstream: 'origin/main', ahead: 1, behind: 0 }, 'Push'],
      [{ upstream: 'origin/main', ahead: 0, behind: 0 }, 'Fetch'],
    ]
    for (const [status, label] of cases) {
      draw(status)
      expect(primary().textContent?.trim()).toBe(label)
      host.replaceChildren()
      for (const dispose of disposers.splice(0)) dispose()
    }
  })

  it('runs the verb it names', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 0 })
    primary().click()
    expect(remote).toHaveBeenCalledWith('push')
  })

  it('shows the counts beside itself rather than on itself', () => {
    draw({ upstream: 'origin/main', ahead: 144, behind: 2 })
    expect(host.textContent).toContain('↓2 ↑144')
    expect(primary().textContent?.trim()).toBe('Pull')
  })
})

describe('the bar itself', () => {
  it('names the project and the branch, and carries the folder\'s copy button', () => {
    draw({ branch: 'james/thing', upstream: 'origin/james/thing', ahead: 0, behind: 0 })
    expect(host.textContent).toContain('widget /')
    expect(host.textContent).toContain('james/thing')
    // Moved down from the header in this phase. The path is the title, because it is too long to
    // draw beside a branch name.
    expect(host.querySelector('.copy-btn')?.getAttribute('title')).toBe('Copy the project folder: /src/widget')
  })

  it('says so rather than drawing a blank branch on a detached HEAD', () => {
    draw({ branch: null })
    expect(host.textContent).toContain('detached HEAD')
  })
})

describe('the remote menu', () => {
  it('offers fetch, both pulls and both pushes', () => {
    draw({ upstream: 'origin/main', ahead: 0, behind: 0 })
    expect(openMenu().map((item) => item.textContent?.trim()))
      .toEqual(['Fetch', 'Pull', 'Pull with rebase', 'Push', 'Force push'])
  })

  it('is shut while a verb is already running, and so is the primary button', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 0 }, true)
    expect(menuTrigger().disabled).toBe(true)
    expect(primary().getAttribute('data-busy')).not.toBeNull()
  })

  it('sends the rebase form of a pull from its own item', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 1 })
    openMenu().find((item) => item.textContent?.trim() === 'Pull with rebase')!.click()
    expect(remote).toHaveBeenCalledWith('rebase')
  })

  // Armed rather than behind a dialog: the armed label is the prompt on every host, and a dialog was
  // refused by the programme's decisions table.
  it('makes force push ask twice', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 0 })
    const force = openMenu().find((item) => item.textContent?.trim() === 'Force push')!
    force.click()
    expect(remote).not.toHaveBeenCalled()
    expect(document.querySelector('.ui-menu')?.textContent).toContain('Force push?')

    document.querySelector<HTMLButtonElement>('.ui-menu .ui-confirm button')!.click()
    expect(remote).toHaveBeenCalledWith('force')
  })
})

describe('the operation banner', () => {
  it('stays away while nothing is in flight', () => {
    draw({ upstream: 'origin/main', ahead: 0, behind: 0 })
    expect(host.querySelector('.ui-alert')).toBeNull()
  })

  it('names the operation and disables the primary button under it', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 1, operation: 'rebase' })
    expect(host.querySelector('.ui-alert-title')?.textContent).toBe('Rebase in progress')
    // Disabled rather than hidden: the row keeps its shape, and the tooltip is where the reason goes.
    expect(primary().disabled).toBe(true)
    expect(primary().getAttribute('data-tip')).toContain('Finish or abort')
  })

  it('says Merge in progress for a merge', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 1, operation: 'merge' })
    expect(host.querySelector('.ui-alert-title')?.textContent).toBe('Merge in progress')
  })

  // Abort is destructive, so it arms like every other destructive verb in this pane.
  it('arms Abort before it runs one', () => {
    draw({ upstream: 'origin/main', ahead: 1, behind: 1, operation: 'rebase' })
    byText('Abort')!.click()
    expect(remote).not.toHaveBeenCalled()

    byText('Abort?')!.click()
    expect(remote).toHaveBeenCalledWith('abort')
  })
})

// The room another plugin has under the bar (docs/plugins.md § Cooperative extension points). What
// belongs here is this owner's half: the point draws nothing on its own, and a contributor is handed
// the five facts the bar reads and no markup. Who wins a contested slot is `Slot`'s business and
// client-core tests it.

/** The props the last contributor render was handed. A contributor is an ordinary component here,
 *  because a compiled plugin's tree is already in this process; a loaded plugin's crosses as node
 *  names and neither the owner nor this test can tell which answered. */
let handed: PushActionsProps | null = null

const Contributor = (props: PushActionsProps) => {
  handed = { ...props }
  return <button type="button">Open pull request</button>
}

const point = () =>
  registered.push(extensionPointRegistry.register({
    id: PUSH_ACTIONS_POINT,
    ownerId: 'changes',
    label: 'After a push',
    kind: 'remote',
    mode: 'stack',
    max: PUSH_ACTIONS_MAX,
  }))

const contributor = () =>
  registered.push(extensionRegistry.register({
    id: 'other.push-actions',
    pluginId: 'other',
    point: PUSH_ACTIONS_POINT,
    label: 'Open pull request',
    order: 10,
    carrier: 'component',
    component: Contributor,
  } as ExtensionContribution))

describe('the push-actions slot', () => {
  it('draws nothing and takes no space when nobody fills it', () => {
    point()
    draw({ upstream: 'origin/main', ahead: 1, behind: 0 })
    // The bar and its two buttons, and no third element after the toolbar: an unfilled point has no
    // wrapper, so the footer is the height it was before the slot existed.
    expect(host.textContent).not.toContain('Open pull request')
    expect(host.querySelector('.ui-toolbar')?.nextElementSibling).toBeNull()
  })

  it('hands a contributor the five facts the bar reads, and no markup', () => {
    handed = null
    point()
    contributor()
    draw({ branch: 'james/thing', upstream: 'origin/james/thing', ahead: 3, behind: 0 })
    expect(host.textContent).toContain('Open pull request')
    expect(handed).toEqual({
      taskId: 't1',
      projectId: 'p1',
      branch: 'james/thing',
      upstream: 'origin/james/thing',
      ahead: 3,
    })
  })

  it('says a branch has no upstream rather than deciding for the contributor', () => {
    handed = null
    point()
    contributor()
    draw({ branch: 'james/thing' })
    // The owner does not know which contributor cares about an upstream, so it reports the fact and
    // the contributor gates on it. Here that is a `null`, not a missing key.
    expect(handed).toMatchObject({ upstream: null, ahead: null })
  })
})
