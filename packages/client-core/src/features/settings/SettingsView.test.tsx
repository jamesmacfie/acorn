import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../kit/lib/state/registry'

// The shell's four promises, each one a thing a person would notice the moment it broke: a plugin page
// that declares nothing still has a home, a deep link lands on its page, the header's node switcher
// never moves the window's own node, and settings reopens where it was left.
type TestWorkspace = { id: string; name: string; projects: unknown[] }
const mocks = vi.hoisted(() => ({
  // An accessor, so a test can stand in for a refetch with a signal.
  workspaces: (() => []) as () => TestWorkspace[],
  projects: [] as { id: string; name: string; workspaceId: string }[],
  nodes: [] as { nodeId: string; label: string }[],
  integrations: undefined as unknown,
  attention: [] as unknown[],
  // An accessor for the same reason: a test flips it to stand in for the roster arriving.
  rosterKnown: (() => true) as () => boolean,
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { key: string }) => ({
    get data() {
      const key = options().key
      return key === 'workspaces' ? mocks.workspaces() : key === 'projects' ? mocks.projects : key === 'integrations' ? mocks.integrations : undefined
    },
    isLoading: false,
  }),
  useQueryClient: () => ({}),
}))
vi.mock('../../infra/queries', () => ({
  workspacesOptions: () => ({ key: 'workspaces' }),
  projectsOptions: () => ({ key: 'projects' }),
  integrationsOptions: () => ({ key: 'integrations' }),
  prefsOptions: () => ({ key: 'prefs' }),
}))
vi.mock('../../infra/node/fleet', () => ({
  nodes: () => mocks.nodes,
  homeNode: () => mocks.nodes[0],
  nodeIsStarting: () => false,
  refreshFleet: async () => {},
  ORIGIN_NODE_ID: 'origin',
}))
vi.mock('../../infra/node/hostCapabilities', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../infra/node/hostCapabilities')>(),
  pluginRosterKnown: () => mocks.rosterKnown(),
}))
vi.mock('../notifications/attentionInbox', () => ({ createAttentionInbox: () => () => ({ rows: mocks.attention, unavailable: [] }) }))

import SettingsView, { type SettingsRequest } from './SettingsView'
import { WillConfirmationHost } from '../../host/registries/shell/willPhase'
import { useUnsavedChanges } from './unsavedChanges'
import { useSettingsDetail } from './settingsDetail'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { settingsRegistry, type SettingsContribution } from '../../host/registries/shell/settings'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { takePluginRequest } from './plugins/installed'
import { takeConnectionRequest } from './connections/connections'

const page = (id: string, extra: Partial<SettingsContribution> = {}): SettingsContribution => ({
  id, label: id, order: 10, component: () => <p data-page={id}>{id} body</p>, ...extra,
})

let host: HTMLElement
let dispose: (() => void) | undefined
const held: Disposable[] = []

let closed = 0
const open = (request: SettingsRequest = {}) => {
  dispose?.()
  dispose = render(() => (
    <>
      <SettingsView request={request} onClose={() => { closed += 1 }} />
      <WillConfirmationHost />
    </>
  ), host)
}
const search = (text: string) => {
  const field = host.querySelector<HTMLInputElement>('input[type="search"]')!
  field.value = text
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  return field
}
// A result's page step and its name, read as one line: "Terminal › Text".
const results = () => [...host.querySelectorAll('.settings-rail-result')].map((item) =>
  [item.querySelector('.settings-rail-result-page')?.textContent, item.querySelector('.settings-rail-label')?.textContent].filter(Boolean).join(' '))
const title = () => host.querySelector('.settings-title')?.textContent
const railItem = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.settings-rail-item')].find((item) => item.textContent === label)
const groupOf = (label: string) => railItem(label)?.closest('[role="group"]')?.getAttribute('aria-label')

beforeEach(() => {
  closed = 0
  localStorage.clear()
  mocks.integrations = undefined
  mocks.attention = []
  mocks.rosterKnown = () => true
  mocks.nodes = [{ nodeId: 'node-a', label: 'Laptop' }, { nodeId: 'node-b', label: 'Build box' }]
  setActiveNode('node-a')
  host = document.createElement('div')
  document.body.append(host)
  held.push(
    settingsRegistry.register(page('appearance', { label: 'Appearance', category: 'general', scope: 'device' })),
    settingsRegistry.register(page('shortcuts', { label: 'Keyboard shortcuts', category: 'general', scope: 'device', order: 30 })),
    settingsRegistry.register(page('plugins', {
      label: 'Plugins', category: 'plugins', followsNodeSwitcher: true,
      component: (props) => <p data-page="plugins">reads {props.context.scope.nodeId}</p>,
    })),
    // What a loaded plugin's settings frame registers when its manifest names none of the new fields.
    settingsRegistry.register(page('board-settings', { label: 'Board', group: 'general', requires: undefined })),
  )
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const disposable of held.splice(0)) disposable.dispose()
  setActiveNode(null)
})

describe('SettingsView', () => {
  it('files a page that names no group under Features', () => {
    open()
    expect(groupOf('Board')).toBe('Features')
    expect(groupOf('Appearance')).toBe('General')
  })

  it('opens the page a deep link names, prefix and section included', () => {
    open({ target: 'settings/shortcuts#bindings' })
    expect(title()).toBe('Keyboard shortcuts')
    // The path above the title names only what the page sits under.
    expect(host.querySelector('.settings-breadcrumb')?.textContent).toBe('General')
    expect(host.querySelector('.settings-scopes .ui-badge')?.textContent).toBe('This device')
    // Focus is in the rail, on the open page's row, so nothing typed reaches what had it before.
    expect(document.activeElement?.textContent).toBe('Keyboard shortcuts')
  })

  it('points a page at the switched node without moving the window\'s active node', () => {
    open({ target: 'plugins' })
    expect(host.querySelector('[data-page="plugins"]')?.textContent).toBe('reads node-a')
    const native = host.querySelector<HTMLSelectElement>('.settings-header select')!
    native.value = 'node-b'
    native.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.querySelector('[data-page="plugins"]')?.textContent).toBe('reads node-b')
    expect(activeNodeId()).toBe('node-a')
    // Every visit starts on the active node again.
    open({ target: 'plugins' })
    expect(host.querySelector('[data-page="plugins"]')?.textContent).toBe('reads node-a')
  })

  it('takes focus back when something under the layer grabs it, and leaves it with a dialog above', () => {
    const under = document.createElement('textarea')
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    const field = document.createElement('input')
    dialog.append(field)
    document.body.append(under, dialog)
    open({ target: 'shortcuts' })
    // What the palette does on close: hand focus back to the terminal it was opened from.
    under.focus()
    expect(document.activeElement?.textContent).toBe('Keyboard shortcuts')
    field.focus()
    expect(document.activeElement).toBe(field)
    under.remove()
    dialog.remove()
  })

  it('names the node a page reads, as plain text, when the page does not follow the switcher', () => {
    open({ target: 'board-settings' })
    expect(host.querySelector('.settings-header select')).toBeNull()
    expect(host.querySelector('.settings-scopes .ui-badge')?.textContent).toBe('Node: Laptop')
  })

  it('reopens on the last page used when nothing asks for another', () => {
    open()
    expect(title()).toBe('Appearance')
    railItem('Plugins')!.click()
    expect(title()).toBe('Plugins')
    open()
    expect(title()).toBe('Plugins')
  })

  it('falls back to the first page, and says so, when the page asked for is not on this node', () => {
    open({ target: 'gone' })
    expect(title()).toBe('Appearance')
    expect(host.querySelector('[role="status"]')?.textContent).toBe("This page isn't available any more.")
  })

  it('waits for the plugin roster before giving up on a remembered page', () => {
    const [known, setKnown] = createSignal(false)
    mocks.rosterKnown = known
    open({ target: 'late' })
    expect(host.querySelector('[role="status"]')).toBeNull()
    held.push(settingsRegistry.register(page('late', { label: 'Late' })))
    setKnown(true)
    expect(title()).toBe('Late')
  })

  it('lists the node\'s workspaces after Overview and draws the workspace page for one', () => {
    const [workspaces, setWorkspaces] = createSignal<TestWorkspace[]>([{ id: 'ws-1', name: 'Runn', projects: [] }])
    mocks.workspaces = workspaces
    held.push(
      settingsRegistry.register(page('workspaces', { label: 'Overview', category: 'workspaces' })),
      settingsRegistry.register(page('workspace.detail', {
        label: 'Workspace', category: 'workspaces', scope: 'workspace', order: 20,
        component: (props) => <p data-page="workspace">{props.context.scope.workspace?.name}</p>,
      })),
    )
    open({ target: 'workspaces' })
    const rows = [...host.querySelectorAll('[aria-label="Workspaces and projects"] .settings-rail-item')].map((item) => item.textContent)
    expect(rows).toEqual(['Overview', 'Runn'])
    railItem('Runn')!.click()
    expect(host.querySelector('[data-page="workspace"]')?.textContent).toBe('Runn')
    expect([...host.querySelectorAll('.settings-scopes .ui-badge')].map((chip) => chip.textContent)).toEqual(['Workspace', 'Node: Laptop'])
    // A refetch hands back new objects. The row keeps its button, and with it the focus.
    railItem('Runn')!.focus()
    setWorkspaces([{ id: 'ws-1', name: 'Runn', projects: [] }])
    expect(document.activeElement?.textContent).toBe('Runn')
    mocks.workspaces = () => []
  })

  it('shows a workspace\'s projects only while it is expanded, deep-links a project, and goes back with ⌘[', () => {
    mocks.workspaces = () => [{ id: 'ws-1', name: 'Runn', projects: [] }]
    mocks.projects = [{ id: 'p-1', name: 'acorn', workspaceId: 'ws-1' }]
    held.push(
      settingsRegistry.register(page('workspaces', { label: 'Overview', category: 'workspaces' })),
      settingsRegistry.register(page('workspace.detail', { label: 'Workspace', category: 'workspaces', scope: 'workspace', order: 20 })),
      settingsRegistry.register(page('project.detail', {
        label: 'Project', category: 'workspaces', scope: 'project', order: 30,
        component: (props) => <p data-page="project">{props.context.scope.project?.name} in {props.context.scope.workspace?.name}</p>,
      })),
    )
    // A workspace with projects reads as its name and whether it is open: "Runn (closed)".
    const railRows = () => [...host.querySelectorAll('[aria-label="Workspaces and projects"] .settings-rail-item')].map((item) => {
      const expanded = item.getAttribute('aria-expanded')
      return expanded === null ? item.textContent : `${item.textContent} (${expanded === 'true' ? 'open' : 'closed'})`
    })
    open({ target: 'workspaces' })
    expect(railRows()).toEqual(['Overview', 'Runn (closed)'])
    railItem('Runn')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(railRows()).toEqual(['Overview', 'Runn (open)', 'acorn'])

    open({ target: 'settings/project/p-1' })
    expect(host.querySelector('[data-page="project"]')?.textContent).toBe('acorn in Runn')
    expect(host.querySelector('.settings-breadcrumb')?.textContent).toBe('Workspaces and projects › Runn')
    expect([...host.querySelectorAll('.settings-scopes .ui-badge')].map((chip) => chip.textContent)).toEqual(['Project', 'Node: Laptop'])
    // The workspace in the path is the way back, and its tip names the chord.
    const crumb = [...host.querySelectorAll<HTMLElement>('.settings-crumb')].find((item) => item.textContent === 'Runn')!
    expect(crumb.dataset.tipKey).toBe('⌘[')
    // Opening a project expands its workspace, and its list is the workspace's page.
    expect(railRows()).toEqual(['Overview', 'Runn (open)', 'acorn'])
    const back = () => host.querySelector('.settings-view')!.dispatchEvent(new KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', metaKey: true, bubbles: true, cancelable: true }))
    back()
    expect(title()).toBe('Runn')
    back()
    expect(title()).toBe('Overview')
    mocks.workspaces = () => []
    mocks.projects = []
  })

  it('ranks page names, then section names, then row labels, then keywords, and lands on the section', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    held.push(settingsRegistry.register(page('terminal', {
      label: 'Terminal', category: 'features', scope: 'device',
      keywords: ['drawer'],
      sections: [
        { id: 'drawer', label: 'Drawer defaults', rows: ['Open on click'] },
        { id: 'text', label: 'Text', rows: ['Drawer text size'], keywords: ['font'] },
      ],
      component: () => (
        <>
          <SettingsSection id="drawer" label="Drawer defaults"><p>rows</p></SettingsSection>
          <SettingsSection id="text" label="Text"><p>rows</p></SettingsSection>
        </>
      ),
    })))
    held.push(settingsRegistry.register(page('drawers', { label: 'Drawer', category: 'features', order: 20 })))
    open({ target: 'appearance' })

    search('drawer')
    // The page called Drawer, then the section, then the row, and the page whose keyword matched last.
    // Each shows where it lands: the section, with its page as a step above it.
    expect(results()).toEqual(['Drawer', 'Terminal › Drawer defaults', 'Terminal › Text', 'Terminal'])

    search('zzz')
    expect(host.querySelector('.settings-rail-empty')?.textContent).toBe('No settings match "zzz".')

    search('font')
    expect(results()).toEqual(['Terminal › Text'])
    const field = search('font')
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(title()).toBe('Terminal')
    const section = host.querySelector<HTMLElement>('[data-settings-section="text"]')!
    expect(section.hasAttribute('data-highlight')).toBe(true)
    expect(host.querySelector('[data-settings-section="drawer"]')?.hasAttribute('data-highlight')).toBe(false)
    vi.advanceTimersByTime(3000)
    expect(section.hasAttribute('data-highlight')).toBe(false)
    vi.useRealTimers()
  })

  it('asks before Escape drops a form\'s unsaved changes, and stays when told to', async () => {
    const [dirty, setDirty] = createSignal(true)
    held.push(settingsRegistry.register(page('agents', {
      label: 'Custom agents', category: 'agents',
      component: () => {
        useUnsavedChanges(dirty)
        return <p>form</p>
      },
    })))
    open({ target: 'agents' })
    const escape = () => host.querySelector('.settings-view')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] .ui-modal-actions button')].find((item) => item.textContent === label)

    escape()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Discard unsaved changes')
    button('Cancel')!.click()
    await Promise.resolve()
    expect(closed).toBe(0)

    escape()
    button('Discard changes')!.click()
    await Promise.resolve()
    expect(closed).toBe(1)

    // A saved form leaves without a word.
    setDirty(false)
    escape()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(closed).toBe(2)
  })

  it('lands an old page id on the page that absorbed it, at the section it moved to', () => {
    held.push(settingsRegistry.register(page('agent-limits', {
      label: 'Limits and cost', category: 'agents', aliases: ['agent-concurrency#limits', 'agent-pricing#claude'],
    })))
    open({ target: 'agent-pricing' })
    expect(title()).toBe('Limits and cost')
    expect(railItem('Limits and cost')?.getAttribute('aria-current')).toBe('page')
    // The remembered page is the live id, so the next visit does not go through the alias again.
    expect(localStorage.getItem('acorn.settings.last-page')).toBe('agent-limits#claude')
  })

  it('draws the plugin strip above a plugin\'s page, outside the box the page draws in', () => {
    held.push(
      sourceRegistry.register({ id: 'board-src', order: 50, glyph: 'x', label: 'Board' }, 'board'),
      settingsRegistry.register(page('board-own', {
        label: 'Board own', category: 'features',
        // Its own source gets a switch; a core source named here gets none.
        railSourceVisibility: ['board-src', 'home'],
        component: () => <p data-page="board-own">board body</p>,
      }), 'board'),
    )
    open({ target: 'board-own' })
    const strip = host.querySelector<HTMLElement>('.settings-plugin-strip')!
    const body = host.querySelector<HTMLElement>('.settings-body')!
    const content = host.querySelector('[data-page="board-own"]')!
    expect(strip.textContent).toContain('board plugin')
    // Before the body in the document, never inside it, and the page's content is inside the body, which
    // is its own containing block and stacking context (settings.css).
    expect(strip.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(body.contains(strip)).toBe(false)
    expect(body.contains(content)).toBe(true)
    expect(body.hasAttribute('data-plugin')).toBe(true)
    expect([...strip.querySelectorAll('[role="switch"]')].map((box) => box.closest('label')?.textContent)).toEqual(['Show in left rail'])

    // Manage plugin opens that plugin's page under Installed.
    const manage = [...strip.querySelectorAll('button')].find((button) => button.textContent === 'Manage plugin')!
    manage.click()
    expect(title()).toBe('Plugins')
    expect(takePluginRequest()?.id).toBe('board')

    // A core page has no strip, and its body is not marked as a plugin's.
    open({ target: 'appearance' })
    expect(host.querySelector('.settings-plugin-strip')).toBeNull()
    expect(host.querySelector('.settings-body')?.hasAttribute('data-plugin')).toBe(false)
  })

  it('dots Services for a refused connection, and opens the connection page from its name', () => {
    held.push(settingsRegistry.register(page('integrations', { label: 'Services', category: 'connections' })))
    mocks.integrations = {
      providers: [{ id: 'linear', label: 'Linear', kind: 'issue-tracker', glyph: 'L', capabilities: {}, connection: { authKind: 'api-key', fields: [], connectable: true, disconnectable: true } }],
      integrations: [{ id: 'c-1', providerId: 'linear', label: 'Linear · Acme', status: 'needs-auth' }],
    }
    // What ./connections/connectionAttention.ts reports for it.
    mocks.attention = [{ nodeId: 'node-a', sourceId: 'core.connectionsNeedAuth', item: { id: 'x', title: 't', severity: 'warn', at: 1, target: { kind: 'settings', resourceId: 'integrations' } } }]
    open({ target: 'appearance' })
    expect(railItem('Services')?.querySelector('.ui-dot')?.getAttribute('data-tone')).toBe('warn')
    expect(railItem('Appearance')?.querySelector('.ui-dot')).toBeNull()

    search('acme')
    expect(results()).toEqual(['Services › Linear · Acme'])
    host.querySelector<HTMLButtonElement>('.settings-rail-result')!.click()
    expect(title()).toBe('Services')
    expect(takeConnectionRequest('integrations')).toEqual({ kind: 'connection', id: 'c-1' })
  })

  it('opens a linked item only once the page is on screen, so staying on a form opens nothing later', async () => {
    const [dirty, setDirty] = createSignal(true)
    held.push(
      settingsRegistry.register(page('integrations', { label: 'Services', category: 'connections' })),
      settingsRegistry.register(page('form', {
        label: 'Form', category: 'agents',
        component: () => {
          useUnsavedChanges(dirty)
          return <p>form</p>
        },
      })),
    )
    mocks.integrations = {
      providers: [{ id: 'linear', label: 'Linear', kind: 'issue-tracker', glyph: 'L', capabilities: {}, connection: { authKind: 'api-key', fields: [], connectable: true, disconnectable: true } }],
      integrations: [{ id: 'c-1', providerId: 'linear', label: 'Linear · Acme', status: 'connected' }],
    }
    open({ target: 'form' })
    const answer = async (label: string) => {
      ;[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] .ui-modal-actions button')].find((item) => item.textContent === label)!.click()
      await Promise.resolve()
    }

    search('acme')
    host.querySelector<HTMLButtonElement>('.settings-rail-result')!.click()
    await answer('Cancel')
    expect(title()).toBe('Form')
    expect(takeConnectionRequest('integrations')).toBeUndefined()

    host.querySelector<HTMLButtonElement>('.settings-rail-result')!.click()
    await answer('Discard changes')
    expect(title()).toBe('Services')
    expect(takeConnectionRequest('integrations')).toEqual({ kind: 'connection', id: 'c-1' })
    setDirty(false)
  })

  it('goes back to a page\'s list when its own rail row is clicked from one of its items', () => {
    held.push(settingsRegistry.register(page('custom-agents', {
      label: 'Custom agents', category: 'agents',
      component: () => {
        const [editing, setEditing] = createSignal(false)
        return (
          <Show when={editing()} fallback={<button type="button" data-open onClick={() => setEditing(true)}>list</button>}>
            {(() => {
              useSettingsDetail(() => 'Reviewer', () => setEditing(false))
              return <p data-editor>editor</p>
            })()}
          </Show>
        )
      },
    })))
    open({ target: 'custom-agents' })
    host.querySelector<HTMLButtonElement>('[data-open]')!.click()
    expect(title()).toBe('Reviewer')
    railItem('Custom agents')!.click()
    expect(title()).toBe('Custom agents')
    expect(host.querySelector('[data-editor]')).toBeNull()
  })

  it('names an open detail in the header and goes back to its list, asking first when it holds changes', async () => {
    const [editing, setEditing] = createSignal(true)
    const [dirty, setDirty] = createSignal(false)
    held.push(settingsRegistry.register(page('custom-agents', {
      label: 'Custom agents', category: 'agents',
      component: () => (
        <Show when={editing()} fallback={<p>list</p>}>
          {(() => {
            useUnsavedChanges(dirty)
            useSettingsDetail(() => 'Reviewer', () => setEditing(false))
            return <p>editor</p>
          })()}
        </Show>
      ),
    })))
    open({ target: 'custom-agents' })
    expect(title()).toBe('Reviewer')
    expect(host.querySelector('.settings-breadcrumb')?.textContent).toBe('Agents › Custom agents')
    // The page in the path is the link back to its list.
    const backLink = () => [...host.querySelectorAll<HTMLButtonElement>('.settings-crumb')].find((item) => item.textContent === 'Custom agents')

    setDirty(true)
    backLink()!.click()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Discard unsaved changes')
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] .ui-modal-actions button')].find((item) => item.textContent === 'Discard changes')!.click()
    await Promise.resolve()
    expect(editing()).toBe(false)
    // Back on the list, the header is the page's own again and has no back link.
    expect(title()).toBe('Custom agents')
    expect(backLink()).toBeUndefined()
  })
})
