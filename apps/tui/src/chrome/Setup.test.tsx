/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { prefsKey, projectsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
import type { QueryClient } from '@tanstack/solid-query'
import { activeNodeId, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/infra/node/fleet.ts'
import { renderFixture } from '../harness'

async function command(screen: Awaited<ReturnType<typeof renderFixture>>, query: string) {
  await screen.press('k', { ctrl: true })
  for (const letter of query) await screen.press(letter)
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
    const screen = await renderFixture({ cache: (client) => {
      client.setQueryData(prefsKey, { 'core.workspaces': 'off' })
    } })
    try {
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
