/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from '../harness'

async function command(screen: Awaited<ReturnType<typeof renderFixture>>, query: string) {
  await screen.press('k', { ctrl: true })
  for (const letter of query) await screen.press(letter)
  await screen.press('RETURN')
}

describe('terminal setup route', () => {
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
