import { createLibrary, defineAction, defineComponent, type ActionEvent, type ActionPlan } from '@openuidev/lang-core'
import { For } from 'solid-js'
import { render } from 'solid-js/web'
import { describe, expect, it } from 'vitest'
import { caseFiles, caseIds, json, paramsOf, propsOf, readCase, same, spec } from '../test/conformanceCases.ts'
import {
  FormScope,
  Renderer,
  createOpenUIRuntime,
  createStateField,
  useFormName,
  useOpenUI,
  type ComponentRenderer,
} from './index.ts'

// Level 2 of OpenUI's conformance cases: each case with interactions.json, mounted through `Renderer` and
// replayed. It follows OpenUI's reference runner at the copied commit,
// https://github.com/thesysdev/openui/blob/8d9c4c3/packages/react-lang/src/__tests__/conformance.interactions.test.tsx:
// the test components register a handler under their statement name, and a step calls it.

type Dict = Record<string, unknown>

let clicks = new Map<string, () => unknown>()
let inputs = new Map<string, (text: string) => void>()

const Generic: ComponentRenderer<Dict> = (props) => (
  <div>
    <For each={Object.values(props.props)}>{(value) => props.renderNode(value)}</For>
  </div>
)

const RENDERERS: Record<string, ComponentRenderer<Dict>> = {
  Form: (props) => (
    <FormScope name={props.props.name as string}>
      <form>{props.renderNode(props.props.children)}</form>
    </FormScope>
  ),
  Input: (props) => {
    const field = createStateField(
      () => props.props.name as string,
      () => props.props.value,
    )
    inputs.set(props.statementId!, (text) => field.setValue(text, 'input'))
    return <input readOnly value={String(field.value() ?? '')} />
  },
  Button: (props) => {
    const runtime = useOpenUI()
    const formName = useFormName()
    clicks.set(props.statementId!, () =>
      runtime.triggerAction(props.props.label as string, formName, props.props.action as ActionPlan),
    )
    return <button>{String(props.props.label)}</button>
  },
}

const library = {
  ...createLibrary<ComponentRenderer<any>>({
    components: Object.entries(spec.components).map(([name, { description }]) =>
      defineComponent({ name, description, props: propsOf(name), component: RENDERERS[name] ?? Generic }),
    ),
    actions: Object.entries(spec.schema.actions ?? {}).map(([name, action]) =>
      defineAction({ name, description: '', params: paramsOf(action.params) }),
    ) as never,
    root: spec.root,
  }),
  toJSONSchema: () => spec.schema as never,
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function runInteractions(
  program: string,
  { interactions: steps, expected }: { interactions: Dict[]; expected: Dict },
) {
  clicks = new Map()
  inputs = new Map()
  const events: ActionEvent[] = []
  const toolCalls: Dict[] = []
  const tools: Record<string, (args: Dict) => Promise<unknown>> = {}
  const setTool = (name: string, result: unknown) => {
    tools[name] = async (args) => (toolCalls.push({ tool: name, args: json(args) }), json(result))
  }
  // Tool steps before the first user step apply before the program mounts.
  let i = 0
  for (; i < steps.length && 'tool' in steps[i]; i++) setTool(steps[i].tool as string, steps[i].result)

  let runtime!: ReturnType<typeof createOpenUIRuntime>
  const dispose = render(() => {
    runtime = createOpenUIRuntime({ program: () => program, library, tools, onAction: (e) => events.push(e) })
    return <Renderer runtime={runtime} />
  }, document.createElement('div'))
  const diffs: string[] = []
  try {
    await settle()
    for (; i < steps.length; i++) {
      const step = steps[i]
      if ('tool' in step) {
        setTool(step.tool as string, step.result)
        continue
      }
      const [id, text] = 'type' in step ? (step.type as [string, string]) : [step.click as string, '']
      const handler = 'type' in step ? inputs.get(id) : clicks.get(id)
      if (!handler) {
        diffs.push(`step ${i}: nothing rendered for ${id}`)
        break
      }
      await handler(text)
      await settle()
      // Unlike the reference runner, this runtime waits for typing to pause before it runs a query.
      if ('type' in step) await new Promise((resolve) => setTimeout(resolve, 300))
    }

    // Each expected event is compared on the keys it lists; null means absent or null.
    const want = (expected.events as Dict[]) ?? []
    const got = json(events) as unknown as Dict[]
    const eventsMatch =
      want.length === got.length && want.every((w, k) => Object.entries(w).every(([key, v]) => same(v, got[k][key])))
    if (!eventsMatch) diffs.push(`events: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
    for (const [key, value] of Object.entries((expected.state as Dict) ?? {})) {
      if (!same(value, runtime.state(key)))
        diffs.push(`state ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(runtime.state(key))}`)
    }
    // Consecutive identical calls count once.
    const calls = toolCalls.filter((call, k) => k === 0 || !same(call, toolCalls[k - 1]))
    if (expected.toolCalls && !same(expected.toolCalls, calls))
      diffs.push(`toolCalls: expected ${JSON.stringify(expected.toolCalls)}, got ${JSON.stringify(calls)}`)
  } finally {
    dispose()
  }
  return diffs
}

describe('OpenUI conformance, interaction cases', () => {
  const ids = caseIds().filter((id) => 'interactions.json' in caseFiles(id))

  it('reads every copied case', () => {
    expect(ids).toHaveLength(12)
  })

  for (const id of ids) {
    it(id, async () => {
      const diffs = await runInteractions(readCase(id, 'input.oui'), JSON.parse(readCase(id, 'interactions.json')))
      expect(diffs, id).toEqual([])
    })
  }
})
