import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskRef } from '../../main/core'
import {
  applyTaskChecks,
  clearTaskChecks,
  collectTaskConcerns,
  registerTaskCheck,
  sanitizeConcern,
} from './taskChecks'

const task: TaskRef = { id: 't1', title: 'A task', projectId: 'p1', branch: 'feat/x', worktreePath: '/tmp/wt', pullNumber: null }

afterEach(() => {
  for (const owner of ['docker', 'changes', 'slow', 'bad', 'noisy']) clearTaskChecks(owner)
  vi.restoreAllMocks()
})

describe('collectTaskConcerns', () => {
  it('qualifies the id and stamps the plugin, whatever the check said', async () => {
    registerTaskCheck({
      pluginId: 'docker',
      id: 'containers',
      // A check claiming somebody else's id and plugin. Neither reaches the dialog.
      check: async () => ({ id: 'changes', pluginId: 'changes', message: '8 running', severity: 'warn' }) as never,
      apply: async () => {},
    })
    await expect(collectTaskConcerns(task)).resolves.toEqual([
      { id: 'docker:containers:changes', pluginId: 'docker', message: '8 running', severity: 'warn' },
    ])
  })

  it('draws no checkbox for a check that cannot apply one', async () => {
    registerTaskCheck({
      pluginId: 'changes',
      id: 'uncommitted',
      check: async () => ({ id: 'files', message: '3 uncommitted files', severity: 'danger', action: { label: 'Discard them', checked: true } }),
    })
    const [concern] = await collectTaskConcerns(task)
    expect(concern?.action).toBeUndefined()
    expect(concern?.severity).toBe('danger')
  })

  it('drops a slow check without dropping the others', async () => {
    vi.useFakeTimers()
    registerTaskCheck({ pluginId: 'slow', id: 'hangs', check: () => new Promise(() => {}) })
    registerTaskCheck({ pluginId: 'changes', id: 'fast', check: async () => ({ id: 'files', message: '1 uncommitted file', severity: 'danger' }) })
    const pending = collectTaskConcerns(task)
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(pending).resolves.toEqual([
      { id: 'changes:fast:files', pluginId: 'changes', message: '1 uncommitted file', severity: 'danger' },
    ])
    vi.useRealTimers()
  })

  it('drops a throwing check without dropping the others', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerTaskCheck({ pluginId: 'bad', id: 'throws', check: async () => { throw new Error('boom') } })
    registerTaskCheck({ pluginId: 'changes', id: 'fast', check: async () => ({ id: 'files', message: 'still here', severity: 'warn' }) })
    await expect(collectTaskConcerns(task)).resolves.toHaveLength(1)
  })

  it('refuses a second check under one id', () => {
    registerTaskCheck({ pluginId: 'docker', id: 'containers', check: async () => null })
    expect(() => registerTaskCheck({ pluginId: 'docker', id: 'containers', check: async () => null }))
      .toThrow(/Duplicate task check 'docker:containers'/)
  })
})

describe('sanitizeConcern', () => {
  it('caps the details at five and keeps the plugin\'s overflow count', () => {
    const concern = sanitizeConcern('changes', 'uncommitted', {
      id: 'files',
      message: 'lots',
      severity: 'danger',
      details: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      detailsMore: 12,
    }, false)
    expect(concern?.details).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(concern?.detailsMore).toBe(12)
  })

  it('keeps the good details and drops the unusable ones', () => {
    const concern = sanitizeConcern('x', 'y', { id: 'z', message: 'm', severity: 'warn', details: ['a', 42, '', null, 'b'] }, false)
    expect(concern?.details).toEqual(['a', 'b'])
  })

  it('is null for anything that is not a concern', () => {
    expect(sanitizeConcern('x', 'y', null, false)).toBeNull()
    expect(sanitizeConcern('x', 'y', 'a string', false)).toBeNull()
    expect(sanitizeConcern('x', 'y', { id: 'z', severity: 'warn' }, false)).toBeNull()
    expect(sanitizeConcern('x', 'y', { message: 'm', severity: 'warn' }, false)).toBeNull()
  })

  it('coerces an unknown severity down to warn', () => {
    expect(sanitizeConcern('x', 'y', { id: 'z', message: 'm', severity: 'catastrophe' }, false)?.severity).toBe('warn')
  })
})

describe('applyTaskChecks', () => {
  it('runs only the cleanups whose concern was ticked', async () => {
    const ran: string[] = []
    registerTaskCheck({ pluginId: 'docker', id: 'containers', check: async () => null, apply: async () => void ran.push('docker') })
    registerTaskCheck({ pluginId: 'changes', id: 'uncommitted', check: async () => null, apply: async () => void ran.push('changes') })
    await expect(applyTaskChecks(task, ['docker:containers:containers'])).resolves.toEqual([])
    expect(ran).toEqual(['docker'])
  })

  it('ignores an id naming a check this node does not have', async () => {
    await expect(applyTaskChecks(task, ['ghost:gone:x', 'nonsense'])).resolves.toEqual([])
  })

  it('gives up on a cleanup that hangs, and names it', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerTaskCheck({ pluginId: 'slow', id: 'c', check: async () => null, apply: () => new Promise(() => {}) })
    const pending = applyTaskChecks(task, ['slow:c:x'])
    await vi.advanceTimersByTimeAsync(61_000)
    await expect(pending).resolves.toEqual(['slow'])
    vi.useRealTimers()
  })

  it('names the plugin whose cleanup threw, and still runs the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ran: string[] = []
    registerTaskCheck({ pluginId: 'bad', id: 'c', check: async () => null, apply: async () => { throw new Error('nope') } })
    registerTaskCheck({ pluginId: 'docker', id: 'c', check: async () => null, apply: async () => void ran.push('docker') })
    await expect(applyTaskChecks(task, ['bad:c:x', 'docker:c:x'])).resolves.toEqual(['bad'])
    expect(ran).toEqual(['docker'])
  })
})
