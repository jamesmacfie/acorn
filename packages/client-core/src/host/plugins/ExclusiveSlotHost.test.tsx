import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../kit/lib/registry'
import { clearExclusiveSlotFailures, exclusiveSlotFailed, exclusiveSlotRegistry } from '../registries/extensionPoints/exclusiveSlots'
import ExclusiveSlotHost from './ExclusiveSlotHost'

// The one site where a plugin draws in place of a core surface, and the one site that guarantees core
// gets it back. The arbitration rule itself is unit-tested next door in `exclusiveSlots.test.ts`;
// what only a render can show is the third way back — the surface throws and core returns — which the
// live-QA checklist has been carrying as a manual step.

// `prefs` is the whole query surface this host uses: one preference holding the arbitration map.
const prefs = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({
    get data() {
      return { 'core.exclusive-slots': prefs.value }
    },
  }),
}))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))
vi.mock('../../infra/persistence/prefKeys', () => ({ PrefKeys: { exclusiveSlots: 'core.exclusive-slots' } }))

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const mount = (element: () => unknown) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(element as () => never, host)
}

const core = () => <span data-mark="core" />

const offer = (pluginId: string, component: () => unknown) =>
  registered.push(
    exclusiveSlotRegistry.register({
      id: `plugin:${pluginId}:tasks`,
      pluginId,
      slot: 'rail.taskList',
      label: `${pluginId} task list`,
      component: component as () => never,
    }),
  )

// The boundary reports the throw through Solid's own error path, which logs. Nothing here is a real
// failure, so keep the output readable.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  prefs.value = undefined
})

afterEach(() => {
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
  clearExclusiveSlotFailures()
  vi.restoreAllMocks()
})

describe('ExclusiveSlotHost', () => {
  it('draws core when nobody is chosen', () => {
    offer('rival', () => <span data-mark="rival" />)

    mount(() => <ExclusiveSlotHost slot="rail.taskList" core={core} />)

    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('core')
  })

  it('draws the chosen provider in place of core', () => {
    offer('rival', () => <span data-mark="rival" />)
    prefs.value = JSON.stringify({ 'rail.taskList': 'rival' })

    mount(() => <ExclusiveSlotHost slot="rail.taskList" core={core} />)

    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('rival')
  })

  it('does not evaluate core while a provider is drawing', () => {
    const evaluated = vi.fn()
    offer('rival', () => <span data-mark="rival" />)
    prefs.value = JSON.stringify({ 'rail.taskList': 'rival' })

    mount(() => (
      <ExclusiveSlotHost
        slot="rail.taskList"
        core={() => {
          evaluated()
          return core()
        }}
      />
    ))

    // `core` is a function, not a JSX prop, so a replaced surface costs nothing. If this ever fires,
    // every user who replaced the task list is paying for two of them.
    expect(evaluated).not.toHaveBeenCalled()
  })

  it('falls back to core when the chosen surface throws, and records why', async () => {
    offer('rival', () => {
      throw new Error('replacement exploded')
    })
    prefs.value = JSON.stringify({ 'rail.taskList': 'rival' })

    mount(() => <ExclusiveSlotHost slot="rail.taskList" core={core} />)

    // The flip is out of band: a render must not write a signal it is being rendered from, so the
    // boundary queues a microtask and core draws on the next tick.
    await Promise.resolve()
    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('core')
    // Recorded in the registry as well as locally, so Settings can say the choice is not in effect.
    expect(exclusiveSlotFailed('rail.taskList', 'rival')).toBe(true)
  })

  it('draws core when the chosen plugin has gone', () => {
    prefs.value = JSON.stringify({ 'rail.taskList': 'uninstalled' })

    mount(() => <ExclusiveSlotHost slot="rail.taskList" core={core} />)

    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('core')
  })

  it('follows the preference live, because the preference is the source of truth', () => {
    const [choice, setChoice] = createSignal<string | undefined>(undefined)
    Object.defineProperty(prefs, 'value', { get: choice, configurable: true })
    offer('rival', () => <span data-mark="rival" />)

    mount(() => <ExclusiveSlotHost slot="rail.taskList" core={core} />)
    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('core')

    setChoice(JSON.stringify({ 'rail.taskList': 'rival' }))
    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('rival')
  })
})
