import type {
  WorkflowCatalog,
  WorkflowDef,
  WorkflowValueBinding,
} from '../shared/workflowContracts'

const MAX_WORKFLOW_CATALOG_CHARS = 16_000

const workflowTargetRef = (target: NonNullable<WorkflowCatalog['workflows']>[number]): string =>
  JSON.stringify(target.ref)

const workflowTargetBlock = (
  target: NonNullable<WorkflowCatalog['workflows']>[number],
  includeSchemas: boolean,
): string => {
  const lines = [`### ${target.name}`, '', `Reference: \`${workflowTargetRef(target)}\``]
  if (!target.inputs.length) lines.push('', 'Inputs: none.')
  else {
    lines.push('', 'Inputs:')
    lines.push(...target.inputs.map((input) => {
      const requirement = input.required && !input.hasDefault ? 'required' : input.hasDefault ? 'has a saved default' : 'optional'
      return `- \`${input.name}\`, ${requirement}.${input.description ? ` ${input.description}` : ''}`
    }))
  }
  if (includeSchemas && target.outputs?.length) {
    lines.push('', 'Terminal structured outputs:')
    lines.push(...target.outputs.map((output) => `- \`${output.step}\`: ${JSON.stringify(output.schema)}`))
  }
  return lines.join('\n')
}

/** Describes the exact child workflow targets that grounding accepts. */
export function renderWorkflowTargets(
  catalog: WorkflowCatalog,
  budget = MAX_WORKFLOW_CATALOG_CHARS,
): string {
  const targets = catalog.workflows ?? []
  const lines = [
    '## 6. Saved child workflows',
    '',
    'A `workflow` step starts one saved workflow in its own child task. A `workflow-map` step reads an',
    'array from a structured predecessor and starts one child task and saved workflow per item. Both',
    'wait for every child they admit. Use only a reference listed below. Never invent an id or path.',
    '',
    'A child input binding is one of these closed shapes:',
    '',
    '- `{ "from": "literal", "value": "text" }`.',
    '- `{ "from": "input", "name": "declaredParentInput" }`.',
    '- `{ "from": "step", "step": "structured-predecessor", "pointer": "/field" }`.',
    '- `{ "from": "item", "pointer": "/field" }`, only inside `workflow-map`.',
    '',
    'A JSON Pointer starts with `/`, or is empty for the whole value. It never contains `__proto__`,',
    '`prototype`, or `constructor`. A step binding and a map source must name a transitive predecessor',
    'that declares structured output.',
  ]
  if (!targets.length) {
    lines.push('', 'This project has no saved child workflows. Do not write a `workflow` or `workflow-map` step.')
    return lines.join('\n')
  }

  const first = targets[0]!
  const requiredInputs = first.inputs.filter((input) => input.required && !input.hasDefault)
  const singleBindings: Record<string, WorkflowValueBinding> = Object.fromEntries(requiredInputs.map((input) => [
    input.name,
    { from: 'input', name: input.name },
  ]))
  const mapBindings: Record<string, WorkflowValueBinding> = Object.fromEntries(requiredInputs.map((input) => [
    input.name,
    { from: 'item', pointer: `/${input.name}` },
  ]))
  const titleName = requiredInputs[0]?.name ?? 'id'
  const singleExample: WorkflowDef = {
    name: `Run ${first.name}`,
    ...(requiredInputs.length ? {
      inputs: requiredInputs.map((input) => ({ name: input.name, required: true })),
    } : {}),
    steps: [{
      name: 'run-child',
      kind: 'workflow',
      after: [],
      childWorkflow: {
        ref: first.ref,
        ...(requiredInputs.length ? { inputs: singleBindings } : {}),
      },
    }],
  }
  const mapExample: WorkflowDef = {
    name: `Map ${first.name}`,
    steps: [
      {
        name: 'select-items',
        after: [],
        prompt: 'Select the items to process.',
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: Object.fromEntries([
                  ['id', { type: 'string' }],
                  ...requiredInputs.filter((input) => input.name !== 'id').map((input) => [input.name, { type: 'string' }]),
                ]),
              },
            },
          },
        },
      },
      {
        name: 'run-for-each-item',
        kind: 'workflow-map',
        after: ['select-items'],
        items: { step: 'select-items', pointer: '/items' },
        itemKey: '/id',
        childWorkflow: {
          ref: first.ref,
          ...(requiredInputs.length ? { inputs: mapBindings } : {}),
        },
        title: {
          template: `Process \${${titleName}}`,
          bindings: { [titleName]: { from: 'item', pointer: `/${titleName}` } },
        },
      },
    ],
  }
  lines.push(
    '',
    'Single-child example:',
    '',
    JSON.stringify(singleExample, null, 2),
    '',
    'Collection-mapping example. `select-items` declares the shown schema, so `/items` selects an array:',
    '',
    JSON.stringify(mapExample, null, 2),
    '',
    'Available references:',
    '',
  )
  const withoutSchemas = targets.map((target) => workflowTargetBlock(target, false)).join('\n\n')
  const withSchemas = targets.map((target) => workflowTargetBlock(target, true)).join('\n\n')
  const prefix = lines.join('\n')
  const rendered = `${prefix}${prefix.length + withSchemas.length <= budget ? withSchemas : withoutSchemas}`
  if (rendered.length <= budget) return rendered
  // List every reference when the input details exceed the section budget.
  return `${prefix}${targets.map((target) => `- ${target.name.slice(0, 200)}: \`${workflowTargetRef(target)}\``).join('\n')}`
}
