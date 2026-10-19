import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppListing } from '../shared/api'

const mocks = vi.hoisted(() => ({
  writeJson: vi.fn(),
  refreshApps: vi.fn(async () => undefined),
  addAppToDashboard: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'n',
  writeJson: mocks.writeJson,
  taskById: () => ({ projectId: 'p' }),
}))
// The menu of Home tabs, reduced to one button that picks Home.
vi.mock('./addToDashboard', () => ({
  addAppToDashboard: mocks.addAppToDashboard,
  AddToDashboardMenu: (props: { label: string; onSelect: (tab: { id: string; name: string }) => void }) => (
    <button onClick={() => props.onSelect({ id: '', name: 'Home' })}>{props.label}</button>
  ),
}))
vi.mock('./appsStore', () => ({
  appById: (appId: string) =>
    appId === 'app-project00001' ? { appId, projectId: 'p', name: 'Checklist', head: 4 } : undefined,
  refreshApps: mocks.refreshApps,
}))
import { PublishButton } from './PublishButton'

const draft: AppListing = {
  appId: 'app-0123456789ab',
  taskId: 't',
  name: 'Checklist',
  description: '',
  head: 3,
  updatedAt: 0,
  draftOf: { appId: 'app-project00001', revision: 2, head: 1 },
}

let host: HTMLDivElement, dispose: () => void
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
afterEach(() => {
  dispose?.()
  host?.remove()
  vi.clearAllMocks()
})
const draw = (app: AppListing, addToDashboard = false) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <PublishButton app={app} addToDashboard={addToDashboard} />, host)
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === label)!

it('asks before replacing a project app that moved since the draft started, and sends the choice', async () => {
  mocks.writeJson.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  draw(draft)
  button('Publish').click()
  await settle()
  expect(JSON.parse(mocks.writeJson.mock.calls[0]![1].body)).toEqual({ mode: 'safe' })
  expect(document.body.textContent).toContain('at v4, and this draft started from v2')
  expect(button('Publish as a new app')).toBeTruthy()

  mocks.writeJson.mockResolvedValueOnce({ appId: 'app-project00001', revision: 5 })
  button('Replace anyway').click()
  await settle()
  expect(JSON.parse(mocks.writeJson.mock.calls[1]![1].body)).toEqual({ mode: 'replace' })
  expect(document.body.textContent).not.toContain('Replace anyway')
})

it('offers Publish to project on a task app, and nothing to publish on an unchanged draft', () => {
  draw({ ...draft, draftOf: undefined })
  expect(button('Publish to project')).toBeTruthy()
  dispose()
  host.remove()
  draw({ ...draft, head: 1 })
  expect(button('Publish').disabled).toBe(true)
})

it('publishes a task app, then puts the project app on the Home tab the person picked', async () => {
  mocks.writeJson.mockResolvedValueOnce({ appId: 'app-project00001', revision: 1 })
  draw({ ...draft, draftOf: undefined }, true)
  button('Publish and add to dashboard').click()
  await settle()
  expect(JSON.parse(mocks.writeJson.mock.calls[0]![1].body)).toEqual({ mode: 'safe' })
  expect(mocks.addAppToDashboard).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'app-project00001', projectId: 'p' }),
    { id: '', name: 'Home' },
  )
})

it("adds an unchanged draft's project app without publishing it again", () => {
  draw({ ...draft, head: 1 }, true)
  button('Publish and add to dashboard').click()
  expect(mocks.writeJson).not.toHaveBeenCalled()
  expect(mocks.addAppToDashboard).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-project00001' }), {
    id: '',
    name: 'Home',
  })
})
