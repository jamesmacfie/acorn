import { createSignal, type Component } from 'solid-js'
import { Dynamic, render } from 'solid-js/web'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { outputPlanColumns } from '@acorn/dashboards-core/plan.ts'
import type { StageFormProps } from '../features/dashboards/studio/stageFormParts'

// Drives a panel step form in jsdom the way a person would: by the visible caption of each control.
// The form edits its plan's first step, and every change lands back in the plan it renders from.

export function mountStageForm<Op extends PanelPlan['stages'][number]['op']>(form: Component<StageFormProps<Op>>, initial: PanelPlan,
  sources: Record<string, DataSourceDescription | undefined> = {}) {
  const [plan, setPlan] = createSignal(initial)
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <Dynamic component={form as unknown as Component<StageFormProps>} stage={plan().stages[0]!} plan={plan()} sources={sources}
    columns={outputPlanColumns({ ...plan(), stages: [] })}
    onChange={stage => setPlan(current => ({ ...current, stages: [stage, ...current.stages.slice(1)] }))} />, host)
  /** The control a caption labels, the `nth` when several share it. */
  const control = (caption: string, nth = 0): HTMLElement => {
    const label = [...host.querySelectorAll('label')].filter(entry => entry.textContent === caption)[nth]
    const element = label && document.getElementById(label.htmlFor)
    if (!element) throw new Error(`No control labelled ${caption}`)
    return element
  }
  // A kit Select keeps a hidden native select beside its trigger, which holds the options and value.
  const native = (caption: string, nth = 0) => control(caption, nth).previousElementSibling as HTMLSelectElement
  return {
    plan,
    /** The edited step, parsed by the plan schema, which throws when the form wrote an invalid one. */
    stage: () => panelPlanSchema.parse(plan()).stages[0] as Extract<PanelPlan['stages'][number], { op: Op }>,
    has: (caption: string) => [...host.querySelectorAll('label')].some(entry => entry.textContent === caption),
    options: (caption: string, nth = 0) => [...native(caption, nth).options].map(option => option.textContent ?? ''),
    choose: (caption: string, optionLabel: string, nth = 0) => {
      const select = native(caption, nth)
      const option = [...select.options].find(entry => entry.textContent === optionLabel)
      if (!option) throw new Error(`${caption} has no option ${optionLabel}`)
      select.value = option.value
      select.dispatchEvent(new Event('change'))
    },
    type: (caption: string, value: string, nth = 0) => {
      const input = control(caption, nth) as HTMLInputElement
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    press: (text: string) => {
      const button = [...host.querySelectorAll('button')].find(entry => entry.textContent?.trim() === text)
      if (!button) throw new Error(`No button ${text}`)
      button.click()
    },
    /** Opens a fold by its summary, as a click on it does in a browser. */
    open: (summary: string) => {
      const fold = [...host.querySelectorAll('summary')].find(entry => entry.textContent?.trim() === summary)?.parentElement as HTMLDetailsElement | undefined
      if (!fold) throw new Error(`No fold ${summary}`)
      fold.open = true
      fold.dispatchEvent(new Event('toggle'))
    },
    text: () => host.textContent ?? '',
    dispose: () => { dispose(); host.remove() },
  }
}

/** A one-source plan with a column of each type the forms treat differently, and one step. */
export function formPlan(stage: PanelPlan['stages'][number]): PanelPlan {
  return panelPlanSchema.parse({
    version: 2, title: 'Pull requests', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' }, view: { kind: 'table' },
    sources: [{ id: 'pulls', label: 'Pull requests', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
      name: 'Pulls', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
      query: { source: { pluginId: 'fixture', sourceId: 'pulls' }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
    } } }],
    columns: [
      { id: 'title', label: 'Title', type: 'text', bind: { pulls: { field: '/title' } } },
      { id: 'state', label: 'State', type: 'enum', choices: [{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }], bind: { pulls: { field: '/state' } } },
      { id: 'author', label: 'Author', type: 'person', bind: { pulls: { field: '/author' } } },
      { id: 'reviewer', label: 'Reviewer', type: 'person', bind: { pulls: { field: '/reviewer' } } },
      { id: 'created', label: 'Created', type: 'datetime', bind: { pulls: { field: '/created' } } },
      { id: 'merged', label: 'Merged', type: 'datetime', bind: { pulls: { field: '/merged' } } },
      { id: 'size', label: 'Changed lines', type: 'number', bind: { pulls: { field: '/size' } } },
      { id: 'labels', label: 'Labels', type: 'text', list: true, bind: { pulls: { field: '/labels' } } },
    ],
    stages: [stage],
  })
}
