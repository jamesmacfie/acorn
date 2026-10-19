import { render } from 'solid-js/web'
import type { JSX } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPONENTS } from '../shared/library'

const mocks = vi.hoisted(() => ({
  compose: vi.fn(async () => ({ ok: true })),
  writeJson: vi.fn(),
  panel: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  composeForAgent: mocks.compose,
  writeJson: mocks.writeJson,
  taskById: () => ({ title: 'Migrate billing', branch: 'migrate' }),
}))
// The frame reports itself visible at once, and a panel draws a marker naming its plan and inputs.
vi.mock('@acorn/plugin-api/ui/dashboards', () => ({
  CardFrame: (props: { onVisible?: (visible: boolean) => void; children: JSX.Element }) => {
    props.onVisible?.(true)
    return <div>{props.children}</div>
  },
  PlanPanel: (props: { plan: { title: string }; inputs?: unknown }) => {
    mocks.panel(props.plan.title, props.inputs)
    return <div>{`panel ${props.plan.title}`}</div>
  },
}))
import AppView from './AppView'
import { library } from './bindings'

let host: HTMLDivElement, dispose: () => void
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
afterEach(() => {
  dispose?.()
  host?.remove()
  document.body.replaceChildren()
  vi.clearAllMocks()
})
function draw(program: string, plans: Record<string, unknown> = {}, readOnly = false) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <AppView
        appId="app-0123456789ab"
        taskId="task"
        workspaceId="w"
        nodeId="n"
        files={{ program, plans }}
        readOnly={readOnly}
      />
    ),
    host,
  )
}
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === text)!

describe('what a program can reach', () => {
  it('binds every component in the library', () => {
    expect(Object.keys(library.components).sort()).toEqual(COMPONENTS.map((component) => component.name).sort())
    expect(Object.values(library.components).every((component) => typeof component.component === 'function')).toBe(true)
  })

  it('puts @ToAssistant text in the composer and sends nothing', async () => {
    draw('root = Stack([Button("Ask", @ToAssistant("Why did it fail?"))])')
    button('Ask').click()
    await settle()
    expect(mocks.compose).toHaveBeenCalledWith('task', 'Why did it fail?')
  })

  it('refuses a file: link with a reason, and shows an https link in full before it opens', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    draw(
      'root = Stack([Button("Local", @OpenUrl("file:///etc/passwd")), Button("Web", @OpenUrl("https://example.com/a?b=1"))])',
    )
    button('Local').click()
    await settle()
    expect(host.textContent).toContain('This app tried to open a file: link. Apps open only web links.')
    expect(open).not.toHaveBeenCalled()
    button('Web').click()
    await settle()
    expect(document.body.textContent).toContain('https://example.com/a?b=1')
    expect(open).not.toHaveBeenCalled()
    button('Open').click()
    await settle()
    expect(open).toHaveBeenCalledWith('https://example.com/a?b=1', '_blank', 'noopener,noreferrer')
  })

  it("runs a plan through the run route with the program's inputs, and keeps a set of ticked rows", async () => {
    mocks.writeJson.mockResolvedValue({
      rows: [
        { id: 'r1', values: { title: 'One' } },
        { id: 'r2', values: { title: 'Two' } },
      ],
      diagnostics: { problems: [] },
    })
    draw(
      [
        'root = Stack([List(@Each(rows.rows, "r", ListItem(r.title, null, [], [Checkbox("t", "Done", @Includes($ticked, r._id), null, @Set($ticked, @Toggled($ticked, r._id)))]))), Text(@Count($ticked) + " ticked")])',
        '$ticked = []',
        'rows = Query("open", {taskId: "task"}, {rows: []})',
      ].join('\n'),
      { open: { version: 2, title: 'Open' } },
    )
    await settle()
    expect(mocks.writeJson).toHaveBeenCalledWith(
      '/v1/core/dashboards/run',
      expect.objectContaining({ body: expect.stringContaining('"inputs":{"taskId":"task"}') }),
    )
    const boxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    expect(boxes()).toHaveLength(2)
    boxes()[1]!.click()
    await settle()
    expect(host.textContent).toContain('1 ticked')
    expect(boxes().map((box) => box.checked)).toEqual([false, true])
  })

  it('asks before a row action, and acts only on a row and action the source offered', async () => {
    mocks.writeJson.mockImplementation(async (url: string) =>
      url === '/v1/core/dashboards/run'
        ? {
            rows: [
              {
                id: 'r1',
                values: { title: 'Fix login' },
                records: [{ pluginId: 'p', sourceId: 's', recordId: '1' }],
                actions: [{ id: 'close', label: 'Close', risk: 'write' }],
              },
            ],
            diagnostics: { problems: [] },
          }
        : { outcome: 'done' },
    )
    draw(
      [
        'root = Stack([Button("Close it", Action([@Set($row, "r1"), @Run(close)])), Button("Forge", Action([@Set($row, "r9"), @Run(close)]))])',
        '$row = ""',
        'rows = Query("open", {}, {rows: []})',
        'close = Mutation("rowAction", {plan: "open", row: $row, action: "close"})',
      ].join('\n'),
      { open: { version: 2, title: 'Open' } },
    )
    await settle()
    button('Forge').click()
    await settle()
    expect(document.body.textContent).not.toContain('Close on')
    button('Close it').click()
    await settle()
    expect(document.body.textContent).toContain('Close on Fix login')
    expect(mocks.writeJson).toHaveBeenCalledTimes(1)
    button('Confirm').click()
    await settle()
    expect(mocks.writeJson).toHaveBeenLastCalledWith(
      '/v1/core/data-sources/act',
      expect.objectContaining({ body: expect.stringContaining('"actionId":"close"') }),
    )
  })

  it('passes inputs to a Panel, and draws an older revision read only', async () => {
    draw(
      'root = Stack([Panel("cost", {taskId: "t1"}), Button("Ask", @ToAssistant("x"))])',
      { cost: { title: 'Cost' } },
      true,
    )
    await settle()
    expect(mocks.panel).toHaveBeenCalledWith('Cost', { taskId: 't1' })
    expect(button('Ask').disabled).toBe(true)
    button('Ask').click()
    await settle()
    expect(mocks.compose).not.toHaveBeenCalled()
  })
})
