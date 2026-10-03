import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { defaultSpawnedAgentDefaults, type SpawnedAgentDefaults } from '../../shared/sessionDefaults'
import SpawnedAgentDefaultsSettings from './SpawnedAgentDefaultsSettings'

const providers = [
  { id: 'codex', profileId: 'codex', label: 'Codex', installed: true },
  { id: 'claude', profileId: 'claude-code', label: 'Claude Code', installed: true },
] as AgentProviderDescriptor[]
const advertised = { codex: [
  { id: 'model', label: 'Model', category: 'model' as const, currentValue: 'small',
    values: [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }] },
  { id: 'reasoning', label: 'Reasoning effort', category: 'reasoning' as const, currentValue: 'medium',
    values: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
  { id: 'permissions', label: 'Permissions', category: 'permission' as const, currentValue: 'full',
    values: [{ value: 'full', label: 'Full' }] },
] }
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.innerHTML = '' })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const choose = async (label: string, value: string) => {
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()
  await settle()
  document.querySelector<HTMLButtonElement>(`[role="option"][data-value="${value}"]`)!.click()
  await settle()
}

describe('spawned agent settings', () => {
  it('saves explicit harness, model and effort choices, and retains them when inheritance is restored', async () => {
    const [value, setValue] = createSignal<SpawnedAgentDefaults>({
      ...defaultSpawnedAgentDefaults(), pinned: { claude: { model: 'opus' } },
    })
    const save = vi.fn(async (next: SpawnedAgentDefaults) => { setValue(next) })
    dispose = render(() => <SpawnedAgentDefaultsSettings value={value()} providers={providers}
      advertised={advertised} onSave={save} />, document.body)
    expect(document.querySelector('[aria-label="Spawned agent harness"]')).toBeNull()
    await choose('Spawn settings', 'explicit')
    await choose('Spawned agent harness', 'codex')
    expect(document.querySelector('[aria-label="Spawned agent Permissions"]')).toBeNull()
    await choose('Spawned agent Model', 'large')
    await choose('Spawned agent Reasoning effort', 'high')
    expect(save).toHaveBeenLastCalledWith({ mode: 'explicit', profileId: 'codex', pinned: {
      claude: { model: 'opus' }, codex: { model: 'large', reasoning: 'high' },
    } })
    await choose('Spawn settings', 'inherit')
    expect(save).toHaveBeenLastCalledWith({ mode: 'inherit', profileId: 'codex', pinned: {
      claude: { model: 'opus' }, codex: { model: 'large', reasoning: 'high' },
    } })
    expect(document.querySelector('[aria-label="Spawned agent harness"]')).toBeNull()
    await choose('Spawn settings', 'explicit')
    await choose('Spawned agent Model', '')
    expect(save).toHaveBeenLastCalledWith({ mode: 'explicit', profileId: 'codex', pinned: {
      claude: { model: 'opus' }, codex: { reasoning: 'high' },
    } })
  })

  it('shows a failed save on its row and keeps the selected mode', async () => {
    dispose = render(() => <SpawnedAgentDefaultsSettings value={defaultSpawnedAgentDefaults()}
      providers={providers} advertised={advertised}
      onSave={async () => { throw new Error('Node unavailable') }} />, document.body)
    await choose('Spawn settings', 'explicit')
    expect(document.body.textContent).toContain('Node unavailable')
    expect(document.querySelector('[aria-label="Spawned agent harness"]')).toBeNull()
  })
})
