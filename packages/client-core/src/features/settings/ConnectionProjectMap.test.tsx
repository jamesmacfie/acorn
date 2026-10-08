import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Integration } from '@acorn/protocol/api.ts'

const state = vi.hoisted(() => ({ mode: 'off' as 'on' | 'off' }))
const write = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { key: string }) => ({
    get data() {
      switch (options().key) {
        case 'offered': return [{ id: 'external', label: 'Issue board' }]
        case 'mappings': return []
        case 'workspaces': return [{ id: 'ws', name: 'Workspace', projects: [{ id: 'project', name: 'Repo' }] }]
      }
    },
    isSuccess: true, isError: false, isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
vi.mock('../../infra/queries', () => ({
  integrationMappingsKey: () => ['mappings'], integrationMappingsOptions: () => ({ key: 'mappings' }),
  integrationProjectsOptions: () => ({ key: 'offered' }), workspacesOptions: () => ({ key: 'workspaces' }),
}))
vi.mock('../workspaces/workspacesMode', () => ({ createWorkspacesMode: () => () => state.mode }))
vi.mock('../workspaces/workspaceMutations', () => ({ setIntegrationMappings: write }))

import ConnectionProjectMap from './ConnectionProjectMap'

const connection: Integration = {
  id: 'connection', providerId: 'linear', label: 'Linear', status: 'connected', authKind: 'api-key',
  account: null, scopes: [], capabilities: {}, createdAt: 1, updatedAt: 1,
}
let host: HTMLElement
let dispose: () => void
afterEach(() => { dispose?.(); host?.remove(); write.mockClear() })
const mount = (mode: 'on' | 'off') => {
  state.mode = mode
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ConnectionProjectMap connection={connection} />, host)
}
const select = (index: number, value: string) => {
  const field = host.querySelectorAll<HTMLSelectElement>('select.ui-select-native')[index]!
  field.value = value
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('connection targets', () => {
  it('writes a project choice as workspace membership without projectId while off', async () => {
    mount('off')
    const options = [...host.querySelectorAll<HTMLSelectElement>('select.ui-select-native')[1]!.options].map((option) => option.textContent)
    expect(options).toEqual(['Choose where…', 'Repo'])
    select(0, 'external')
    select(1, 'ws')
    const follow = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Follow')!
    follow.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('connection', [{ workspaceId: 'ws', externalId: 'external' }]))
  })

  it('retains workspace and narrow project choices while on', () => {
    mount('on')
    const options = [...host.querySelectorAll<HTMLSelectElement>('select.ui-select-native')[1]!.options].map((option) => option.textContent)
    expect(options).toEqual(['Choose where…', 'Workspace · All projects', 'Workspace · Repo'])
  })
})
