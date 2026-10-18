import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { RunScriptToolCard } from './RunScriptToolCard'

let host: HTMLDivElement, dispose: () => void
afterEach(() => {
  dispose?.()
  host?.remove()
})
function draw(tool: Partial<AgentToolCardProps['tool']>) {
  host = document.createElement('div')
  document.body.append(host)
  const call = { id: 'tool', name: 'run_script', title: 'run_script', input: '{"code":"return 1"}', ...tool }
  dispose = render(() => <RunScriptToolCard tool={call} taskId="task" defaultOpen />, host)
}
const envelope = (value: unknown) => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] })

it('lists each call and keeps the program folded', () => {
  draw({
    status: 'completed',
    output: envelope({
      ok: true,
      value: 1,
      logs: [],
      calls: [
        { tool: 'agent_read', ok: true },
        { tool: 'memory_write', ok: false, error: 'not_found' },
      ],
    }),
  })
  expect(host.textContent).toContain('Ran a script with 2 tool calls')
  expect(host.textContent).toContain('agent_read: ok')
  expect(host.textContent).toContain('memory_write: not_found')
  const fold = host.querySelector('details')!
  expect(fold.open).toBe(false)
  fold.open = true
  fold.dispatchEvent(new Event('toggle'))
  expect(fold.textContent).toContain('return 1')
})

it('shows why a script failed and where', () => {
  draw({
    status: 'completed',
    output: envelope({ ok: false, error: { message: 'TypeError: boom', line: 3 }, logs: [], calls: [] }),
  })
  expect(host.textContent).toContain('The script failed after 0 tool calls')
  expect(host.textContent).toContain('TypeError: boom (line 3)')
})
