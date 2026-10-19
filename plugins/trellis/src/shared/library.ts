import { z } from 'zod'
import {
  action,
  createLibrary,
  defineComponent,
  defineFunction,
  markReactive,
  type DefinedComponent,
} from '@openuidev/lang-core'

// The spec half of the app library (docs/agent-built-apps.md § The library): each component's props
// and the description the generated prompt shows the model. The Node validates programs and writes
// the guide from this alone; the client pairs each component with a kit binding.
//
// Programs pass props by position, so a stored program depends on their order. Add a prop only at
// the end, never reorder or remove one, give a new required prop a default, and bump the version.

export const LIBRARY_ID = 'acorn-apps'
export const LIBRARY_VERSION = 1

/** Host tools a program may name besides its own plans. */
export const TASK_TOOL = 'task'
export const ROW_ACTION_TOOL = 'rowAction'

const reactive = <T extends z.ZodType>(schema: T): T => (markReactive(schema), schema)
// A child slot takes components, lists of them, and text. The prompt's descriptions say which fit.
const children = z.array(z.any())
const tone = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional()

const spec = <T extends z.ZodObject>(name: string, props: T, description: string) =>
  defineComponent({ name, props, description, component: null })

export const COMPONENTS: DefinedComponent<z.ZodObject, null>[] = [
  spec(
    'Stack',
    z.object({ children, direction: z.enum(['column', 'row']).optional(), gap: tone(['row', 'stack', 'section']) }),
    'Lays its children out in a column (the default) or a row. A Card in a row is as wide as its content.',
  ),
  spec(
    'Card',
    z.object({ title: z.string().nullable(), children }),
    'A bordered group with an optional title. Use one per item or section.',
  ),
  spec('Heading', z.object({ text: z.string() }), 'A section heading.'),
  spec(
    'Text',
    z.object({ text: z.string(), tone: tone(['default', 'muted', 'mono']) }),
    'A line of text. `muted` for secondary text, `mono` for code and identifiers.',
  ),
  spec(
    'Badge',
    z.object({ text: z.string(), tone: tone(['neutral', 'accent', 'ok', 'warn', 'danger']) }),
    'A short status label.',
  ),
  spec(
    'Alert',
    z.object({ text: z.string(), tone: tone(['muted', 'ok', 'warn', 'danger']) }),
    'A message that stands out: a warning, an error, or a note.',
  ),
  spec('Empty', z.object({ text: z.string() }), 'What a section says when it has nothing to show.'),
  spec(
    'Button',
    z.object({ label: z.string(), action: action(), variant: tone(['solid', 'ghost']) }),
    'A button that runs an action: @ToAssistant puts text in the composer, @OpenUrl opens a web link after the person confirms it, @Set and @Reset change state, @Run runs a query again or a mutation. Use Action([...]) for several steps.',
  ),
  spec(
    'Checkbox',
    z.object({
      name: z.string(),
      label: z.string(),
      checked: reactive(z.boolean()),
      hint: z.string().nullable().optional(),
      action: action().optional(),
    }),
    'A tick box. Bind `checked` to a $variable. For a set of ticked rows, pass @Includes($ticked, row._id) as `checked` and @Set($ticked, @Toggled($ticked, row._id)) as `action`.',
  ),
  spec(
    'Input',
    z.object({ name: z.string(), label: z.string(), value: reactive(z.string()), placeholder: z.string().optional() }),
    'A one-line text field. Bind `value` to a $variable.',
  ),
  spec(
    'Textarea',
    z.object({ name: z.string(), label: z.string(), value: reactive(z.string()), rows: z.number().optional() }),
    'A text field of several lines. Bind `value` to a $variable.',
  ),
  spec(
    'Select',
    z.object({ name: z.string(), label: z.string(), items: children, value: reactive(z.string()) }),
    'A dropdown of SelectItem choices. Bind `value` to a $variable.',
  ),
  spec('SelectItem', z.object({ value: z.string(), label: z.string() }), 'One choice in a Select.'),
  spec('Form', z.object({ name: z.string(), children }), 'Groups fields, so an action sees their values together.'),
  spec(
    'List',
    z.object({ items: children, empty: z.string().optional() }),
    'A list of ListItems, with what to say when it is empty.',
  ),
  spec(
    'ListItem',
    z.object({
      title: z.string(),
      description: z.string().nullable().optional(),
      badges: children.optional(),
      actions: children.optional(),
    }),
    'One row of a List: a title, a line under it, Badges beside it, and Buttons at its end.',
  ),
  spec(
    'Panel',
    z.object({ plan: z.string(), inputs: z.record(z.string(), z.any()).optional() }),
    "Draws one of the app's plans with the dashboard's own view: its table, list, board, chart, or stat, with row menus and drill-down. The only chart or table there is. `inputs` fills the plan's input addresses.",
  ),
]

const FUNCTIONS = [
  defineFunction({
    name: 'Includes',
    description: 'Whether a list holds a value.',
    params: z.object({ list: z.array(z.any()).nullable(), value: z.any() }),
    returns: z.boolean(),
    fn: ({ list, value }) => (list ?? []).includes(value),
  }),
  defineFunction({
    name: 'Toggled',
    description: 'The list with the value added, or removed when it is there. Use with @Set to keep ticked rows.',
    params: z.object({ list: z.array(z.any()).nullable(), value: z.any() }),
    returns: z.array(z.any()),
    fn: ({ list, value }) =>
      (list ?? []).includes(value) ? (list ?? []).filter((item) => item !== value) : [...(list ?? []), value],
  }),
  defineFunction({
    name: 'GroupBy',
    description: 'Groups rows by a field, in order of first appearance: [{ key, rows }].',
    params: z.object({ rows: z.array(z.any()).nullable(), field: z.string() }),
    returns: z.array(z.object({ key: z.any(), rows: z.array(z.any()) })),
    fn: ({ rows, field }) => {
      const groups = new Map<unknown, unknown[]>()
      for (const row of rows ?? []) {
        const key = row && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined
        groups.set(key ?? null, [...(groups.get(key ?? null) ?? []), row])
      }
      return [...groups].map(([key, rows]) => ({ key, rows }))
    },
  }),
]

/** The library with each component drawn by `bind(name)`, or with no renderer for the Node's checks. */
export function appLibrary<C = null>(bind: (name: string) => C = () => null as C) {
  return createLibrary<C>({
    id: LIBRARY_ID,
    components: COMPONENTS.map((component) => ({ ...component, component: bind(component.name) })),
    functions: FUNCTIONS,
  })
}
