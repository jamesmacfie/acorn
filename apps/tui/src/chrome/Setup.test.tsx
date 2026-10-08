/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it, vi } from 'vitest'
import { prefsKey, projectsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
import type { QueryClient } from '@tanstack/solid-query'
import { activeNodeId, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/infra/node/fleet.ts'
import { renderFixture } from '../harness'
import { TASK } from '../fixture'
import { currentPath } from '../kit/router'

const reply = (value: unknown, status = 200) => ({
  status, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(value)),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((answer) => { resolve = answer })
  return { promise, resolve }
}

function intercept(method: string, path: string, answer: () => Promise<ReturnType<typeof reply>>) {
  const bridge = window.acorn!
  const original = bridge.nodeFetch!
  const calls: Parameters<typeof original>[1][] = []
  bridge.nodeFetch = (nodeId, request) => {
    if (request.method === method && request.path === path) {
      calls.push(request)
      return answer()
    }
    return original(nodeId, request)
  }
  return { calls, restore: () => { bridge.nodeFetch = original } }
}

function sentJson(request: Parameters<NonNullable<NonNullable<typeof window.acorn>['nodeFetch']>>[1]): unknown {
  if (request.body?.kind !== 'bytes') throw new Error('Expected a JSON request body')
  return JSON.parse(new TextDecoder().decode(request.body.bytes))
}

async function command(screen: Awaited<ReturnType<typeof renderFixture>>, query: string) {
  await screen.press('k', { ctrl: true })
  for (const letter of query) await screen.press(letter)
  await screen.press('RETURN')
}

async function enterPath(screen: Awaited<ReturnType<typeof renderFixture>>) {
  expect(await screen.reach('/absolute/path/to/project')).toBe(true)
  await screen.press('/tmp/new-project')
  expect(await screen.reach('Add folder')).toBe(true)
  await screen.press('RETURN')
}

describe('terminal setup route', () => {
  it('asks an empty Node for its fixed grouping choice, defaulting to separate projects', async () => {
    const screen = await renderFixture({ cache: (client) => {
      client.setQueryData(prefsKey, {})
      client.setQueryData(projectsKey, [])
    } })
    try {
      const frame = await screen.until('Keep each project separate')
      expect(frame).toContain('group projects into workspaces?')
      expect(frame).not.toContain('Choose a workspace')
    } finally { screen.done() }
  }, 30_000)

  it.each([['off', 'Choose a project'], ['on', 'Choose a workspace']] as const)(
    'opens fixed %s mode without asking the first-run question', async (mode, heading) => {
      const screen = await renderFixture({ cache: (client) => {
        client.setQueryData(prefsKey, { 'core.workspaces': mode })
        client.setQueryData(projectsKey, [])
      } })
      try {
        const frame = await screen.until(heading)
        expect(frame).not.toContain('Keep each project separate')
        if (mode === 'off') expect(frame).not.toContain('workspace')
      } finally { screen.done() }
    }, 30_000,
  )

  it('uses project wording in the off-mode palette', async () => {
    let client!: QueryClient
    const screen = await renderFixture({ cache: (queryClient) => {
      client = queryClient
      client.setQueryData(prefsKey, { 'core.workspaces': 'off' })
    } })
    try {
      const projects = client.getQueryCache().find({ queryKey: projectsKey })!
      projects.setState({ ...projects.state, status: 'error', error: new Error('read failed') })
      expect((await screen.frame()).split('\n')[0]).toContain('Project:')
      await screen.press('k', { ctrl: true })
      const frame = await screen.until('tasks and projects')
      expect(frame).not.toContain('tasks, workspaces, and projects')
      for (const letter of 'switch') await screen.press(letter)
      expect(await screen.until('Switch project')).not.toContain('Switch workspace')
    } finally { screen.done() }
  }, 30_000)

  it('reopens setup when the loaded Node loses its last project', async () => {
    let client!: QueryClient
    const screen = await renderFixture({ cache: (queryClient) => {
      client = queryClient
      client.setQueryData(prefsKey, { 'core.workspaces': 'on' })
    } })
    try {
      await screen.until('Browse')
      client.setQueryData(projectsKey, [])
      expect(await screen.until('Choose a workspace')).toContain('Choose a workspace')
    } finally { screen.done() }
  }, 30_000)

  it('waits for a successful zero roster after pending and failed reads with cached zero', async () => {
    let client!: QueryClient
    const screen = await renderFixture({ cache: (queryClient) => {
      client = queryClient
      client.setQueryData(prefsKey, { 'core.workspaces': 'off' })
    } })
    try {
      const query = client.getQueryCache().find({ queryKey: projectsKey })!
      query.setState({ ...query.state, data: [], status: 'success', fetchStatus: 'fetching' })
      expect(await screen.frame()).not.toContain('Set up acorn')
      query.setState({ ...query.state, status: 'error', fetchStatus: 'idle', error: new Error('read failed') })
      expect(await screen.frame()).not.toContain('Set up acorn')
      query.setState({ ...query.state, status: 'success', error: null })
      expect(await screen.until('Set up acorn')).toContain('1. Choose a project')
    } finally { screen.done() }
  }, 30_000)

  it('keeps the first-run answer disabled when either read fails with cached data', async () => {
    let client!: QueryClient
    const screen = await renderFixture({ cache: (queryClient) => {
      client = queryClient
      client.setQueryData(prefsKey, {})
      client.setQueryData(projectsKey, [])
    } })
    const write = vi.fn(async () => reply({ key: 'core.workspaces', value: 'off' }))
    const hook = intercept('PUT', '/v1/core/prefs', write)
    try {
      await screen.until('Keep each project separate')
      const prefs = client.getQueryCache().find({ queryKey: prefsKey })!
      prefs.setState({ ...prefs.state, status: 'error', error: new Error('read failed') })
      expect(await screen.reach('Continue')).toBe(false)
      expect(write).not.toHaveBeenCalled()
      prefs.setState({ ...prefs.state, status: 'success', error: null })
      const projects = client.getQueryCache().find({ queryKey: projectsKey })!
      projects.setState({ ...projects.state, status: 'error', error: new Error('read failed') })
      expect(await screen.reach('Continue')).toBe(false)
      expect(write).not.toHaveBeenCalled()
      projects.setState({ ...projects.state, status: 'success', error: null })
      expect(await screen.reach('Continue')).toBe(true)
    } finally { hook.restore(); screen.done() }
  }, 30_000)

  it.each([['off', '1. Choose a project'], ['on', '1. Choose a workspace']] as const)(
    'waits for the %s answer to save before advancing', async (choice, next) => {
      const screen = await renderFixture({ cache: (client) => {
        client.setQueryData(prefsKey, {})
        client.setQueryData(projectsKey, [])
      } })
      const first = deferred<ReturnType<typeof reply>>()
      const retry = deferred<ReturnType<typeof reply>>()
      let attempts = 0
      const hook = intercept('PUT', '/v1/core/prefs', () => ++attempts === 1 ? first.promise : retry.promise)
      try {
        await screen.until('Keep each project separate')
        if (choice === 'on') {
          expect(await screen.reach('Keep each project separate')).toBe(true)
          await screen.press('RETURN')
          await screen.press('ARROW_DOWN')
          await screen.press('RETURN')
        }
        expect(await screen.reach('Continue')).toBe(true)
        await screen.press('RETURN')
        expect(hook.calls).toHaveLength(1)
        expect(sentJson(hook.calls[0]!)).toEqual({ key: 'core.workspaces', value: choice })
        expect(await screen.frame()).toContain('Keep each project separate or group')
        first.resolve(choice === 'off'
          ? reply({ error: { code: 'save_failed', message: 'Could not save grouping' } }, 500)
          : reply({ key: 'core.workspaces', value: choice }))
        if (choice === 'off') {
          expect(await screen.until('Could not save grouping')).toContain('Keep each project separate or group')
          expect(await screen.reach('Continue')).toBe(true)
          await screen.press('RETURN')
          expect(hook.calls).toHaveLength(2)
          expect(await screen.frame()).not.toContain(next)
          retry.resolve(reply({ key: 'core.workspaces', value: choice }))
        }
        expect(await screen.until(next)).not.toContain('Keep each project separate or group')
      } finally { hook.restore(); screen.done() }
    }, 30_000,
  )

  it('follows a later grouping change while setup still holds its saved separate answer', async () => {
    let client!: QueryClient
    const screen = await renderFixture({ cache: (queryClient) => {
      client = queryClient
      client.setQueryData(prefsKey, {})
      client.setQueryData(projectsKey, [])
    } })
    const hook = intercept('PUT', '/v1/core/prefs', async () => reply({ key: 'core.workspaces', value: 'off' }))
    try {
      await screen.until('Keep each project separate')
      expect(await screen.reach('Continue')).toBe(true)
      await screen.press('RETURN')
      await screen.until('1. Choose a project')
      client.setQueryData(prefsKey, { 'core.workspaces': 'on' })
      expect(await screen.until('Back to workspaces')).toContain('2. Choose a project in')
      expect(await screen.reach('Back to workspaces')).toBe(true)
      await screen.press('RETURN')
      expect(await screen.until('1. Choose a workspace')).toContain('Create workspace')
    } finally { hook.restore(); screen.done() }
  }, 30_000)

  it('creates an off-mode project without a workspaceId', async () => {
    const screen = await renderFixture({ cache: (client) => {
      client.setQueryData(prefsKey, { 'core.workspaces': 'off' })
      client.setQueryData(projectsKey, [])
    } })
    const created = deferred<ReturnType<typeof reply>>()
    const roster = intercept('GET', '/v1/core/workspaces', async () => reply([
      { id: 'ws-1', name: 'acorn', projects: [{ id: 'project-1', name: 'acorn' }, { id: 'new-project', name: 'new-project' }] },
    ]))
    const hook = intercept('POST', '/v1/core/projects', () => created.promise)
    try {
      await screen.until('Choose a project')
      await enterPath(screen)
      expect(hook.calls).toHaveLength(1)
      expect(sentJson(hook.calls[0]!)).toEqual({ path: '/tmp/new-project' })
      created.resolve(reply({ project: { id: 'new-project', name: 'new-project', path: '/tmp/new-project', workspaceId: 'ws-1', vcs: 'none' } }))
      await screen.until('Project new-project added')
      await screen.press('ESCAPE')
      expect(currentPath()).toContain('/p/new-project')
    } finally { hook.restore(); roster.restore(); screen.done() }
  }, 30_000)

  it.each(['switch', 'dispose'] as const)('ignores a late grouping save after %s', async (ending) => {
    const screen = await renderFixture({ cache: (client) => {
      client.setQueryData(prefsKey, {})
      client.setQueryData(projectsKey, [])
    } })
    const saved = deferred<ReturnType<typeof reply>>()
    const hook = intercept('PUT', '/v1/core/prefs', () => saved.promise)
    try {
      await screen.until('Keep each project separate')
      expect(await screen.reach('Continue')).toBe(true)
      await screen.press('RETURN')
      expect(hook.calls).toHaveLength(1)
      if (ending === 'switch') setActiveNode('node-2')
      else await screen.press('ESCAPE')
      const destination = currentPath()
      saved.resolve(reply({ key: 'core.workspaces', value: 'off' }))
      await screen.frame()
      expect(currentPath()).toBe(destination)
      expect(await screen.frame()).not.toContain('1. Choose a project')
    } finally {
      hook.restore()
      if (activeNodeId() !== 'node-1') setActiveNode('node-1')
      screen.done()
    }
  }, 30_000)

  it.each([
    ['project', 'switch'], ['project', 'dispose'], ['task', 'switch'], ['task', 'dispose'],
  ] as const)('ignores a late %s response after %s', async (kind, ending) => {
    const screen = await renderFixture({ cache: kind === 'project' ? (client) => {
      client.setQueryData(prefsKey, { 'core.workspaces': 'off' })
      client.setQueryData(projectsKey, [])
    } : undefined })
    const pending = deferred<ReturnType<typeof reply>>()
    const onCreated = intercept('POST', '/v1/core/tasks/new-task/on-created', async () => reply({ ok: true }))
    const hook = intercept('POST', kind === 'project' ? '/v1/core/projects' : '/v1/core/tasks', () => pending.promise)
    try {
      if (kind === 'project') {
        await screen.until('Choose a project')
        await enterPath(screen)
      } else {
        await command(screen, 'new task')
        await screen.until('Start a task')
        expect(await screen.reach('Task title')).toBe(true)
        await screen.press('Fresh task')
        expect(await screen.reach('Create task')).toBe(true)
        await screen.press('RETURN')
      }
      expect(hook.calls).toHaveLength(1)
      if (ending === 'switch') setActiveNode('node-2')
      else await screen.press('ESCAPE')
      const destination = currentPath()
      pending.resolve(reply(kind === 'project'
        ? { project: { id: 'new-project', name: 'new-project', workspaceId: 'ws-1', path: '/tmp/new-project', vcs: 'none' } }
        : { ...TASK, id: 'new-task', title: 'Fresh task', pullNumber: null, github: null }))
      await screen.frame()
      await new Promise((resolve) => setImmediate(resolve))
      expect(currentPath()).toBe(destination)
      expect(await screen.frame()).not.toContain(kind === 'project' ? 'Project new-project added' : 'Task Fresh task created')
    } finally {
      hook.restore()
      onCreated.restore()
      if (activeNodeId() !== 'node-1') setActiveNode('node-1')
      screen.done()
    }
  }, 30_000)

  it('navigates to a created task after its own close unmounts setup', async () => {
    const screen = await renderFixture()
    const onCreated = intercept('POST', '/v1/core/tasks/new-task/on-created', async () => reply({ ok: true }))
    const hook = intercept('POST', '/v1/core/tasks', async () => reply({ ...TASK, id: 'new-task', title: 'Fresh task', pullNumber: null, github: null }))
    try {
      await command(screen, 'new task')
      await screen.until('Start a task')
      expect(await screen.reach('Task title')).toBe(true)
      await screen.press('Fresh task')
      expect(await screen.reach('Create task')).toBe(true)
      await screen.press('RETURN')
      await screen.until('Task Fresh task created')
      expect(await screen.reach('Start working')).toBe(true)
      await screen.press('RETURN')
      expect(currentPath()).toContain('/t/new-task')
    } finally { hook.restore(); onCreated.restore(); screen.done() }
  }, 30_000)

  it('uses each Node cache and mode after switching away and back', async () => {
    let first!: QueryClient
    const screen = await renderFixture({ cache: (client) => {
      first = client
      client.setQueryData(prefsKey, { 'core.workspaces': 'off' })
    } })
    try {
      expect((await screen.frame()).split('\n')[0]).toContain('Project:')
      const second = clientFor('node-2').client
      for (const key of [projectsKey, workspacesKey, tasksKey]) second.setQueryData(key, first.getQueryData(key))
      second.setQueryData(prefsKey, { 'core.workspaces': 'on' })
      setActiveNode('node-2')
      const grouped = await screen.until('> acorn')
      expect(grouped.split('\n')[0]).not.toContain('Project:')
      setActiveNode('node-1')
      expect((await screen.until('Project:')).split('\n')[0]).toContain('Project:')
    } finally {
      if (activeNodeId() !== 'node-1') setActiveNode('node-1')
      screen.done()
    }
  }, 30_000)

  it('finds Set up acorn in the command palette and offers a typed project path', async () => {
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      await command(screen, 'set up acorn')
      expect(await screen.until('Choose a workspace')).toContain('Choose a workspace')
      expect((await screen.frame()).split('\n').every((line) => line.length <= 80)).toBe(true)
      // The route works after first run too, and Escape returns to the previous focus scope.
      await screen.press('ESCAPE')
      expect(await screen.frame()).not.toContain('Set up acorn')
    } finally {
      screen.done()
    }
  }, 30_000)

  it('opens New task directly on a project and shows the branch choice', async () => {
    const screen = await renderFixture({ width: 120, height: 40 })
    try {
      await command(screen, 'new task')
      const frame = await screen.until('Start a task')
      expect(frame).toContain('Use the project folder and its current branch')
      expect(frame).toContain('Create task')
      expect(frame.split('\n').every((line) => line.length <= 120)).toBe(true)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('keeps provider setup reachable from Set up acorn at 80 columns', async () => {
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      await command(screen, 'set up acorn')
      await screen.until('Choose a workspace')
      expect(await screen.reach('Set up a provider')).toBe(true)
      await screen.press('RETURN')
      const frame = await screen.until('Connect a provider')
      expect(frame).toContain('Installed agent CLIs')
      expect(frame.split('\n').every((line) => line.length <= 80)).toBe(true)
    } finally {
      screen.done()
    }
  }, 30_000)
})
