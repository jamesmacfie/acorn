import { createLibrary, defineComponent } from '@openuidev/lang-core'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Renderer, createOpenUIRuntime, createStateField, reactive, type ComponentRenderer } from './index.ts'

const Stack: ComponentRenderer<{ children: unknown[] }> = (props) => <div>{props.renderNode(props.props.children)}</div>
const Text: ComponentRenderer<{ text: string }> = (props) => <p>{props.props.text}</p>
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
  it('keeps a bound input mounted while the state it writes changes the tree', () => {
    const { host, dispose } = mount()
    const input = host.querySelector('input')!
    input.value = 'late'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.querySelector('input')).toBe(input)
    expect(host.querySelector('p')!.textContent).toBe('You typed: late')
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
})
