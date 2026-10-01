import { createComponent } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import type { PluginSourceDescriptor } from '@acorn/protocol/api.ts'

vi.mock('./remoteSourceRegion', () => ({
  default: (props: { contribution: { entry: string; hash: string }; region: string }) =>
    <span>{`${props.region}:${props.contribution.entry}:${props.contribution.hash}`}</span>,
}))

const { remoteSourcePanel } = await import('./remoteSource')

it('mounts both source regions from the accepted bundle through the remote renderer', async () => {
  const hash = 'a'.repeat(64)
  const descriptor = { id: 'board', label: 'Board', tree: { list: 'browse', detail: 'card' } } as PluginSourceDescriptor
  const panel = remoteSourcePanel('board-plugin', hash, descriptor)
  const container = document.createElement('div')
  const dispose = render(() => <>
    {createComponent(panel.regions!.list, {})}
    {createComponent(panel.regions!.detail, {})}
  </>, container)
  await vi.waitFor(() => expect(container.textContent).toBe(`list:browse:${hash}detail:card:${hash}`))
  // A tree is a run of kit nodes, so its detail asks for the padded, scrolling column a pane body gets.
  expect(panel.regions!.scroll).toBe(true)
  dispose()
})
