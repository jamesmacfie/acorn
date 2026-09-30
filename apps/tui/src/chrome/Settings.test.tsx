/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { SETTINGS_CATEGORY_LABELS } from '@acorn/client-core/host/registries/shell'
import { renderFixture } from '../harness'

async function command(screen: Awaited<ReturnType<typeof renderFixture>>, query: string) {
  await screen.press('k', { ctrl: true })
  for (const letter of query) await screen.press(letter)
  await screen.press('RETURN')
}

const fits = (frame: string, width: number) => frame.split('\n').every((line) => line.length <= width)

describe('terminal settings route', () => {
  it('opens from the palette on every one of the desktop\'s nine groups', async () => {
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      await command(screen, 'settings')
      const frame = await screen.until('Workspaces and projects')
      for (const label of Object.values(SETTINGS_CATEGORY_LABELS)) expect(frame).toContain(label)
      expect(fits(frame, 80)).toBe(true)
      // Escape climbs out: the route closes and the shell is back.
      await screen.press('ESCAPE')
      expect(await screen.frame()).not.toContain('Workspaces and projects')
    } finally {
      screen.done()
    }
  }, 30_000)

  it('lists a page it cannot draw and says which host to open and why', async () => {
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      await command(screen, 'settings')
      await screen.until('Workspaces and projects')
      expect(await screen.reach('Machines')).toBe(true)
      await screen.press('RETURN')
      const list = await screen.until('Security and backup')
      expect(list).toContain('desktop app')
      expect(await screen.reach('Security and backup')).toBe(true)
      await screen.press('RETURN')
      const page = await screen.until('This page opens in the desktop app')
      expect(page).toContain('paired with this node')
      expect(page).toContain('Node: ')
      expect(fits(page, 80)).toBe(true)
      // Back to the group, not out of settings.
      await screen.press('ESCAPE')
      const back = await screen.until('Audit log')
      expect(back).not.toContain('This page opens in the desktop app')
      // With the caret back on the page it came from, so the list answers the arrows at once.
      expect(back).toMatch(/› Security and backup/)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('draws the terminal alert row on Notifications, with the value the environment set', async () => {
    const saved = process.env.ACORN_TUI_NOTIFY
    process.env.ACORN_TUI_NOTIFY = 'bell'
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      await command(screen, 'settings')
      await screen.until('Workspaces and projects')
      // General is the first group and Notifications its second page.
      await screen.press('RETURN')
      await screen.until('Keyboard shortcuts')
      await screen.press('ARROW_DOWN')
      await screen.press('RETURN')
      const frame = await screen.until('Terminal alerts')
      expect(frame).toContain('Bell only')
      expect(frame).toContain('From ACORN_TUI_NOTIFY')
      expect(frame).toContain('This device')
      // A row this host cannot honour is absent, not disabled.
      expect(frame).not.toContain('Show a count on the app icon')
      expect(frame).not.toContain('Play a sound')
      expect(fits(frame, 80)).toBe(true)
    } finally {
      screen.done()
      if (saved === undefined) delete process.env.ACORN_TUI_NOTIFY
      else process.env.ACORN_TUI_NOTIFY = saved
    }
  }, 30_000)

  it('asks the shell\'s one confirmation over the page, and the page is still there after', async () => {
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      const { openSettings } = await import('./settingsStore')
      const { confirmAction } = await import('../kit/host')
      openSettings('notifications')
      await screen.until('Terminal alerts')
      const cancelled = confirmAction({ title: 'Delete agent', actionLabel: 'Delete agent', goes: 'Reviewer goes.', stays: 'Sessions stay.' })
      const dialog = await screen.until('Reviewer goes.')
      expect(dialog).toContain('Sessions stay.')
      expect(dialog).not.toContain('Terminal alerts')
      // The caret starts on Cancel, so Enter out of habit keeps everything.
      await screen.press('RETURN')
      expect(await cancelled).toBe(false)
      expect(await screen.until('Terminal alerts')).not.toContain('Reviewer goes.')

      const confirmed = confirmAction({ title: 'Delete agent', actionLabel: 'Delete agent', goes: 'Reviewer goes.' })
      await screen.until('Reviewer goes.')
      await screen.press('ARROW_DOWN')
      await screen.press('RETURN')
      expect(await confirmed).toBe(true)
    } finally {
      screen.done()
    }
  }, 30_000)
})
