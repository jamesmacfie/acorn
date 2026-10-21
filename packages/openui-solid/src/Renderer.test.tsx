import { createLibrary, defineComponent } from '@openuidev/lang-core'
import { createEffect, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Renderer, createOpenUIRuntime, createStateField, reactive, type ComponentRenderer } from './index.ts'

const Stack: ComponentRenderer<{ children: unknown[] }> = (props) => <div>{props.renderNode(props.props.children)}</div>
let onText: ((text: string) => void) | undefined
const Text: ComponentRenderer<{ text: string }> = (props) => {
  createEffect(() => onText?.(props.props.text))
  return <p>{props.props.text}</p>
}
const Input: ComponentRenderer<{ name: string; value: unknown }> = (props) => {
  const field = createStateField(
    () => props.props.name,
    () => props.props.value,
  )
  return <input value={String(field.value() ?? '')} onInput={(e) => field.setValue(e.currentTarget.value)} />
}

const Broken: ComponentRenderer = () => {
  throw new Error('no')
}

const library = createLibrary<ComponentRenderer<any>>({
  components: [
    defineComponent({ name: 'Broken', description: '', props: z.object({}), component: Broken }),
    defineComponent({
      name: 'Stack',
      description: '',
      props: z.object({ children: z.array(z.any()) }),
      component: Stack,
    }),
    defineComponent({ name: 'Text', description: '', props: z.object({ text: z.string() }), component: Text }),
    defineComponent({
      name: 'Input',
      description: '',
      // A prop that takes a `$` variable two ways is marked reactive.
      props: z.object({ name: z.string(), value: reactive(z.any().optional()) }),
      component: Input,
    }),
  ],
  root: 'Stack',
})

const program = `$q = ""
root = Stack([search, Text("You typed: " + $q)])
search = Input("search", $q)`

function mount(initialState?: Record<string, unknown>, text = () => program) {
  // Solid delegates input events to the document.
  const host = document.body.appendChild(document.createElement('div'))
  let runtime!: ReturnType<typeof createOpenUIRuntime>
  const dispose = render(() => {
    runtime = createOpenUIRuntime({ program: text, library, initialState })
    return <Renderer runtime={runtime} />
  }, host)
  return { host, runtime, dispose: () => (dispose(), host.remove()) }
}

describe('Renderer', () => {
  it('keeps a bound input mounted while the state it writes changes the tree', async () => {
    const { host, dispose } = mount()
    const input = host.querySelector('input')!
    input.value = 'late'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(host.querySelector('p')!.textContent).toBe('You typed: late'))
    expect(host.querySelector('input')).toBe(input)
    dispose()
  })

  it('lets the host seed and read `$` variables', () => {
    const { host, runtime, dispose } = mount({ $q: 'seeded' })
    expect(host.querySelector('p')!.textContent).toBe('You typed: seeded')
    runtime.setState('$q', 'from host')
    expect(host.querySelector('input')!.value).toBe('from host')
    expect(runtime.state('$q')).toBe('from host')
    dispose()
  })

  it('lists a component that fails to draw, and draws the rest', () => {
    const { host, runtime, dispose } = mount(undefined, () => `root = Stack([Broken(), Text("still here")])`)
    expect(host.querySelector('p')!.textContent).toBe('still here')
    expect(runtime.errors().map((e) => e.code)).toEqual(['render-error'])
    dispose()
  })

  it('keeps what the user set when the program changes', () => {
    const [text, setText] = createSignal(program)
    const { host, runtime, dispose } = mount({ $q: 'seeded' }, text)
    runtime.setState('$q', 'typed')
    setText(program.replace('You typed: ', 'Typed: '))
    expect(host.querySelector('p')!.textContent).toBe('Typed: typed')
    dispose()
  })

  it('runs the queries again on refresh, all of them or those calling the named tools', async () => {
    const calls: string[] = []
    const tools = Object.fromEntries(
      ['a', 'b'].map((name) => [name, async () => (calls.push(name), { text: name })] as const),
    )
    const host = document.body.appendChild(document.createElement('div'))
    let runtime!: ReturnType<typeof createOpenUIRuntime>
    const dispose = render(() => {
      runtime = createOpenUIRuntime({
        program: () => `a = Query("a", {}, {text: ""})
b = Query("b", {}, {text: ""})
root = Stack([Text(a.text), Text(b.text)])`,
        library,
        tools,
      })
      return <Renderer runtime={runtime} />
    }, host)
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    await settle()
    expect(calls.sort()).toEqual(['a', 'b'])
    runtime.refresh(['b'])
    await settle()
    expect(calls.sort()).toEqual(['a', 'b', 'b'])
    runtime.refresh()
    await settle()
    expect(calls.sort()).toEqual(['a', 'a', 'b', 'b', 'b'])
    dispose()
    host.remove()
  })

  it('evaluates the program once for the writes of a frame', async () => {
    const seen: string[] = []
    onText = (text) => seen.push(text)
    const { host, runtime, dispose } = mount()
    for (const text of ['a', 'ab', 'abc']) runtime.setState('$q', text)
    await vi.waitFor(() => expect(host.querySelector('p')!.textContent).toBe('You typed: abc'))
    expect(seen).toEqual(['You typed: ', 'You typed: abc'])
    onText = undefined
    dispose()
  })

  it('runs a query again once typing has paused, and at once for an action that sets its argument', async () => {
    vi.useFakeTimers()
    try {
      const calls: unknown[] = []
      const tools = { find: async (args: Record<string, unknown>) => (calls.push(args.q), { text: String(args.q) }) }
      const host = document.body.appendChild(document.createElement('div'))
      let runtime!: ReturnType<typeof createOpenUIRuntime>
      const dispose = render(() => {
        runtime = createOpenUIRuntime({
          program: () => `$q = ""
hits = Query("find", {q: $q}, {text: ""})
root = Stack([Text(hits.text)])`,
          library,
          tools,
        })
        return <Renderer runtime={runtime} />
      }, host)
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toEqual([''])
      for (const text of ['a', 'ab', 'abc']) runtime.setState('$q', text)
      await vi.advanceTimersByTimeAsync(249)
      expect(calls).toEqual([''])
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toEqual(['', 'abc'])
      dispose()
      host.remove()
    } finally {
      vi.useRealTimers()
    }
  })
})
