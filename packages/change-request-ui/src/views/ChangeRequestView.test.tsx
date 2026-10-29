import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extensionPointRegistry, extensionRegistry, type Disposable } from '@acorn/plugin-api/testkit/client'
import { changeRequestPointIds, changeRequestPoints, type ReviewPanelProps } from '../model/points'
import type { ChangeRequestModel } from './detailModel'
import { ChangeRequestView } from './ChangeRequestView'

// The `review-panel` tab beside the diff. The overview and sections read the whole model, and none of
// it decides whether the tab is drawn, so they're stood in for.
vi.mock('./Overview', () => ({ ChangeRequestOverview: () => null }))
vi.mock('./sections', () => ({ changeRequestSections: () => [], ChangeRequestDescription: () => null }))

const model = (scope: { taskId?: string }) =>
  ({
    host: { noun: 'pull request', pluginId: 'github' },
    scope: { owner: 'acme', repo: 'shop', number: '7', ...scope },
    readOnly: false,
    openCheck: () => null,
    setOpenCheck: () => {},
  }) as unknown as ChangeRequestModel

let host: HTMLElement
const disposers: (() => void)[] = []
const registrations: Disposable[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  const panel = changeRequestPoints('Pull request').find((point) => point.id === 'review-panel')!
  registrations.push(extensionPointRegistry.register({ ...panel, id: 'github:review-panel', ownerId: 'github' }))
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const registration of registrations.splice(0)) registration.dispose()
  host.remove()
})

const fillPanel = () =>
  registrations.push(
    extensionRegistry.register({
      id: 'plugin:review-guide:panel',
      pluginId: 'review-guide',
      point: changeRequestPointIds('github').reviewPanel,
      label: 'Guide',
      order: 10,
      carrier: 'component',
      component: (props: ReviewPanelProps) => <p>guide for {props.taskId}</p>,
    }),
  )

const draw = (scope: { taskId?: string }) => {
  disposers.push(
    render(
      () => (
        <ChangeRequestView
          id="test.pull"
          model={model(scope)}
          currentFile={() => undefined}
          onOpenFile={() => {}}
          onLinkClick={() => {}}
          diff={() => <p>the diff</p>}
        />
      ),
      host,
    ),
  )
}

const tabLabels = () => [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)

describe('the review panel tab', () => {
  it('is not drawn when nobody fills the point', () => {
    draw({ taskId: 't1' })
    expect(tabLabels()).toEqual(['Details'])
    expect(host.textContent).toContain('the diff')
  })

  it("draws the contributor's tree, mounted with the task, beside the diff", () => {
    fillPanel()
    draw({ taskId: 't1' })
    expect(tabLabels()).toEqual(['Details', 'Guide'])
    expect(host.textContent).toContain('guide for t1')
    expect(host.textContent).toContain('the diff')
  })

  it('is not drawn on the browse surface, which has no task', () => {
    fillPanel()
    draw({})
    expect(tabLabels()).toEqual(['Details'])
    expect(host.textContent).not.toContain('guide for')
  })
})
