/** @jsxImportSource @acorn/tui/jsx */
import { expect, it, vi } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { renderCells } from '../kit/render'
import { Single } from '../layouts/Single'
import { TreeHost } from './TreeHost'

function fixture() {
  let sequence = 0
  const node = (type: string, props: Record<string, unknown> = {}, children: TreeNode[] = []): TreeNode => ({
    id: `layout-${++sequence}`,
    type,
    props,
    children,
  })
  const text = (value: string) => node('Text', {}, [node('#text', { value })])
  const table = () =>
    node('Table', {}, [
      node('TableRow', { head: true }, [
        node('TableHead', {}, [node('#text', { value: 'Service' })]),
        node('TableHead', {}, [node('#text', { value: 'CPU' })]),
      ]),
      ...Array.from({ length: 40 }, (_, index) =>
        node('TableRow', {}, [
          node('TableCell', {}, [node('#text', { value: `service-${index + 1}` })]),
          node('TableCell', {}, [node('#text', { value: `${index + 1}%` })]),
        ]),
      ),
    ])
  return { node, text, table }
}

async function mountPane(root: TreeNode, width: number, height: number) {
  let send!: (batch: readonly TreeMutation[]) => void
  const refused = vi.fn()
  const screen = await renderCells(
    () => (
      <Single
        stateKey="remote-layout"
        label="Stack"
        regions={{
          body: () => (
            <box flexDirection="column" flexGrow={1}>
              <TreeHost
                pluginId="layout-probe"
                onRefused={refused}
                transport={{
                  onBatch: (listener) => {
                    send = listener
                    return () => {}
                  },
                  onFailed: () => () => {},
                  send: () => {},
                }}
              />
            </box>
          ),
        }}
      />
    ),
    { width, height },
  )
  send([{ op: 'insert', parent: null, index: 0, node: root }])
  await vi.waitFor(async () => expect((await screen.frame()).text).toContain('Running'))
  expect(refused).not.toHaveBeenCalled()
  return { screen, send }
}

it.each([
  [60, 16],
  [120, 40],
])('shows late stats and scrolls their rows while keeping the header at %ix%i', async (width, height) => {
  const { node, text, table } = fixture()
  const loading = text('Sampling containers')
  const panel = node('TabPanel', { idPrefix: 'stack', id: 'stats', active: 'stats' }, [loading])
  const root = node('Pane', { gap: 'row' }, [
    text('Running'),
    node('Tabs', { idPrefix: 'stack', ariaLabel: 'Stack', active: 'stats', tabs: [{ id: 'stats', label: 'Stats' }] }),
    panel,
  ])
  const { screen, send } = await mountPane(root, width, height)
  try {
    expect((await screen.frame()).text).toContain('Sampling containers')
    send([
      { op: 'remove', id: loading.id },
      { op: 'insert', parent: panel.id, index: 0, node: table() },
    ])
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('service-1'))
    const strip = await screen.frame()
    const row = strip.lines.findIndex((line) => line.includes('[Stats]') || line.includes('[Logs]'))
    await screen.click(2, row)
    await screen.press('ARROW_DOWN')
    const tail = await screen.press('END')
    expect(tail.text).toContain('service-40')
    expect(tail.text).toContain('Running')
    expect(tail.text).toContain('[Stats]')
    const resized = await screen.resize(50, 14)
    expect(resized.text).toContain('Running')
    expect(resized.text).toContain('[Stats]')
    expect((await screen.press('HOME')).text).toContain('service-1')
  } finally {
    screen.done()
  }
})

it('lets a remote log own scrolling and retains its controls across a tab switch', async () => {
  const { node, text, table } = fixture()
  const tabs = node('Tabs', {
    idPrefix: 'stack',
    ariaLabel: 'Stack',
    active: 'logs',
    tabs: [
      { id: 'stats', label: 'Stats' },
      { id: 'logs', label: 'Logs' },
    ],
  })
  const stats = node('TabPanel', { idPrefix: 'stack', id: 'stats', active: 'logs' }, [table()])
  const logs = node('TabPanel', { idPrefix: 'stack', id: 'logs', active: 'logs', scroll: false }, [
    node('Stack', { grow: true, gap: 'row' }, [
      text('Service app Follow'),
      node('Log', { ariaLabel: 'App logs', lines: Array.from({ length: 40 }, (_, index) => `log line ${index + 1}`) }),
      text('The last 40 lines.'),
    ]),
  ])
  const { screen, send } = await mountPane(node('Pane', { gap: 'row' }, [text('Running'), tabs, stats, logs]), 60, 20)
  try {
    expect((await screen.frame()).text).toContain('log line 1')
    const strip = await screen.frame()
    const row = strip.lines.findIndex((line) => line.includes('[Stats]') || line.includes('[Logs]'))
    await screen.click(2, row)
    await screen.press('ARROW_DOWN')
    const tail = await screen.press('END')
    for (const value of ['log line 40', 'Running', '[Logs]', 'Service app Follow', 'The last 40 lines.'])
      expect(tail.text).toContain(value)
    for (const active of ['stats', 'logs']) {
      send([tabs, stats, logs].map((item) => ({ op: 'patch' as const, id: item.id, props: { active } })))
      await vi.waitFor(async () =>
        expect((await screen.frame()).text).toContain(active === 'stats' ? 'service-1' : 'log line 40'),
      )
    }
    const resized = await screen.resize(50, 14)
    expect(resized.text).toContain('Service app Follow')
    expect(resized.text).toContain('The last 40 lines.')
  } finally {
    screen.done()
  }
})
