/** @jsxImportSource @acorn/tui/jsx */
import { expect, it } from 'vitest'
import { renderCells } from './render'
import { PanelToolCard } from './dashboards'

const tool = (status: 'running' | 'completed', output?: string) => ({
  id: 'call',
  name: 'panel_show',
  title: 'panel_show',
  status,
  input: JSON.stringify({ title: 'Tasks by status', plan: {} }),
  ...(output ? { output } : {}),
})

it('draws a panel card as one line that says the panel is in the desktop app', async () => {
  const shown = JSON.stringify({ panelId: 'p', shownAt: 1, description: ['One row per Status.'] })
  const screen = await renderCells(() => <PanelToolCard tool={tool('completed', shown)} taskId="t" defaultOpen />, {
    width: 120,
    height: 3,
  })
  expect(screen.lines.filter(Boolean)).toEqual([
    'Tasks by status: One row per Status. The panel draws in the desktop app.',
  ])
  screen.done()
  const refused = await renderCells(
    () => <PanelToolCard tool={tool('completed', '{"status":"api-error"}')} taskId="t" defaultOpen />,
    { width: 120, height: 3 },
  )
  expect(refused.lines.filter(Boolean)).toEqual([
    "Tasks by status: the plan didn't pass its checks, so nothing was drawn.",
  ])
  refused.done()
})
