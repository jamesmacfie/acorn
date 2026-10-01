import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ProjectConfigResponse } from '@acorn/protocol/api.ts'

// A project's page: a value the repo's `.acorn/config.toml` sets is read-only, says where it comes
// from and still shows what this machine holds, and a plugin's `scope: 'project'` page is a tab drawn
// for this project.
const mocks = vi.hoisted(() => ({ response: undefined as ProjectConfigResponse | undefined }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: undefined, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
vi.mock('../tasks/taskBridge', () => ({
  taskBridge: () => ({
    project: { get: async () => mocks.response, config: async () => mocks.response, runTargets: async () => mocks.response },
  }),
}))

import ProjectSettings from './ProjectSettings'
import { settingsRegistry, type SettingsPageContext } from '../../host/registries/shell/settings'
import type { Disposable } from '../../kit/lib/state/registry'

const PROJECT: Project = {
  id: 'p-1', name: 'acorn', path: '/src/acorn', workspaceId: 'ws-1', sort: 0, hidden: false, color: null,
  vcs: 'git', defaultBranch: 'main', remoteUrl: null, github: null,
}
const CONFIG: ProjectConfigResponse['config'] = {
  runTargets: null, editorCommand: null, setupScript: null, setupScriptTrigger: null, devScript: 'pnpm dev',
  devRestartScript: null, teardownScript: null, dbUrlScript: null, dbSchemaMode: null, dbSchemaValue: null,
  dbSchemaNotes: null, previewMode: null, previewValue: null, browserRules: [], branchPrefix: null,
}
const context: SettingsPageContext = {
  scope: { nodeId: 'node-a', project: PROJECT },
  navigate: () => {},
  onWorkspaceDeleted: () => {},
}

let host: HTMLElement
let dispose: (() => void) | undefined
const held: Disposable[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
  for (const disposable of held.splice(0)) disposable.dispose()
})

const mount = () => {
  dispose = render(() => <ProjectSettings project={PROJECT} context={context} />, host)
}
const tab = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === label)
const panelOf = (label: string) => document.getElementById(tab(label)!.getAttribute('aria-controls')!)!
const rowNamed = (label: string) =>
  [...host.querySelectorAll<HTMLElement>('.ui-setting-row')].find((row) => row.querySelector('.ui-setting-label')?.textContent === label)

describe('ProjectSettings', () => {
  it('makes a value the repo sets read-only, names the file, and keeps this machine\'s value in view', async () => {
    mocks.response = { projectId: 'p-1', config: CONFIG, repoConfig: { runTargets: [{ id: 'dev', command: './scripts/dev.sh' }] } }
    mount()
    await vi.waitFor(() => expect(rowNamed('Dev script')).toBeTruthy())

    const dev = rowNamed('Dev script')!
    expect(dev.querySelector('.ui-setting-from')?.textContent).toBe('From .acorn/config.toml')
    expect(dev.querySelector('fieldset')?.disabled).toBe(true)
    expect(dev.textContent).toContain('./scripts/dev.sh')
    expect(dev.querySelector('textarea')?.value).toBe('pnpm dev')
    // A value the repo leaves alone stays editable.
    const setup = rowNamed('Worktree setup script')!
    expect(setup.querySelector('.ui-setting-from')).toBeNull()
    expect(setup.querySelector('fieldset')?.disabled).toBe(false)
  })

  it('draws a plugin\'s project page as a tab, with this project in its context', async () => {
    mocks.response = { projectId: 'p-1', config: CONFIG }
    held.push(settingsRegistry.register({
      id: 'board.project', label: 'Board', category: 'features', scope: 'project', order: 10,
      component: (props) => <p data-board>board for {props.context.scope.project?.name}</p>,
    }))
    mount()
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent))
      .toEqual(['General', 'Setup and scripts', 'Preview', 'Database', 'Connections', 'Board'])
    expect(panelOf('Board').hidden).toBe(true)
    tab('Board')!.click()
    expect(panelOf('Board').hidden).toBe(false)
    expect(panelOf('General').hidden).toBe(true)
    expect(host.querySelector('[data-board]')?.textContent).toBe('board for acorn')
    // Without a rail row of its own: a project page is the only place it is drawn.
    const { isStandaloneSettingsPage } = await import('../../host/registries/shell/settings')
    expect(isStandaloneSettingsPage(settingsRegistry.get('board.project')!)).toBe(false)
  })
})
