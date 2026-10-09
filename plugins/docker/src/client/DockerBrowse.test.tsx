import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/client'

vi.mock('./dockerStore', () => ({
  containers: () => [{ id: 'browse-container', name: 'postgres', image: 'postgres:17', state: 'running', status: 'Up 2 hours', composeProject: null }],
  dockerInfo: () => ({ available: true }), loadError: () => '', loading: () => false,
  refreshDocker: async () => {}, wireDockerRefresh: () => {},
}))
vi.mock('./dockerClient', () => ({ fetchImages: async () => [], fetchVolumes: async () => [], fetchNetworks: async () => [] }))
vi.mock('./wsChannel', () => ({ wsOnDockerChanged: () => () => {} }))
vi.mock('@acorn/plugin-api/ui/host', () => ({ AnnotationMarks: () => null, requestAnnotations: () => {} }))
vi.mock('./ContainerDetail', () => ({ default: (props: { target: string }) => <div>Inspecting {props.target}</div> }))
import DockerBrowse from './DockerBrowse'

const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()); setActiveNode(null) })
const mount = () => {
  const host = document.createElement('div'), client = new QueryClient()
  document.body.append(host)
  const dispose = render(() => <QueryClientProvider client={client}><DockerBrowse /></QueryClientProvider>, host)
  const stop = () => { dispose(); client.clear(); host.remove() }
  stops.push(stop)
  return { host, stop }
}

it('returns to the browser section, filter, and container selection after leaving the source', () => {
  setActiveNode('docker-browse-navigation')
  const first = mount()
  first.host.querySelector<HTMLElement>('[title="postgres · Up 2 hours"]')!.click()
  const filter = first.host.querySelector<HTMLInputElement>('input')!
  filter.value = 'post'
  filter.dispatchEvent(new Event('input', { bubbles: true }))
  first.host.querySelector<HTMLButtonElement>('#docker-section-tab-images')!.click()
  first.stop()

  const returned = mount()
  expect(returned.host.querySelector('#docker-section-tab-images')!.getAttribute('aria-selected')).toBe('true')
  returned.host.querySelector<HTMLButtonElement>('#docker-section-tab-containers')!.click()
  expect(returned.host.textContent).toContain('Inspecting browse-container')
  expect(returned.host.querySelector<HTMLInputElement>('input')!.value).toBe('post')
})
