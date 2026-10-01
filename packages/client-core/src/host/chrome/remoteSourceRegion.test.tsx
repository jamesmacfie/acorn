import { createComponent, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { _resetSidebarCollapse, sidebarCollapse } from '../../kit/lib/layout/collapseState'
import { _resetRemoteTree, setRemoteTree } from '../tree/table'

vi.mock('@solidjs/router', () => ({ useParams: () => ({ projectId: 'project-1' }) }))

const { default: SourceRegion } = await import('./remoteSourceRegion')

// A plugin's list cannot read the host's collapse signal, so the region hands it over as a prop. The
// detail never needs it, and does not get it.

afterEach(() => {
  _resetRemoteTree()
  _resetSidebarCollapse()
  localStorage.clear()
})

it('tells the list, and only the list, when its column collapses', async () => {
  setRemoteTree((props): JSX.Element => <span>{JSON.stringify(props.props())}</span>)
  const contribution = { id: 'board:source.list', pluginId: 'board', hash: 'a'.repeat(64), entry: 'list' }
  const container = document.createElement('div')
  const dispose = render(() => <>
    {createComponent(SourceRegion, { contribution, sourceId: 'source', region: 'list' })}
    {createComponent(SourceRegion, { contribution, sourceId: 'source', region: 'detail' })}
  </>, container)
  await vi.waitFor(() => expect(container.querySelectorAll('span')).toHaveLength(2))
  const [list, detail] = [...container.querySelectorAll('span')].map((span) => JSON.parse(span.textContent ?? ''))
  expect(list).toEqual({ sourceId: 'source', region: 'list', collapsed: false, projectId: 'project-1' })
  expect(detail).toEqual({ sourceId: 'source', region: 'detail', projectId: 'project-1' })

  sidebarCollapse('source')[1](true)
  await vi.waitFor(() => expect(JSON.parse(container.querySelector('span')?.textContent ?? '')).toMatchObject({ collapsed: true }))
  dispose()
})
